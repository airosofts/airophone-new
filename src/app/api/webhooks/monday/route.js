// Receives Monday board webhooks for automations.
//   - Registration handshake: Monday POSTs { challenge } → echo it back.
//   - Events: Monday POSTs { event: { boardId, pulseId, ... } } → for each
//     active automation on that board, text the new lead once.
//
// A freshly-created Monday item often has no phone yet (the form fills columns
// a moment later). When that happens we record the send row as 'pending' and
// the /api/automations/process-pending sweeper retries it until the phone fills.
//
// Authenticity: Monday signs event payloads with a JWT (HS256) using the app's
// signing secret in the Authorization header — verified when present.

import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { supabaseAdmin } from '@/lib/supabase-server'
import { processAutomationItem } from '@/lib/monday-automation'
import { computeScheduledAt } from '@/lib/scheduling'

async function verifySignature(request) {
  const secret = process.env.MONDAY_SIGNING_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || !auth) return true   // best-effort — the handshake has no auth
  try {
    await jwtVerify(auth.replace(/^Bearer\s+/i, ''), new TextEncoder().encode(secret))
    return true
  } catch (err) {
    console.warn('[monday-webhook] JWT verify failed:', err.message)
    return false
  }
}

async function runAutomation(automation, itemId, workspaceHours) {
  // Decide WHEN this should fire. If the automation has a send delay or opts
  // into business hours, the result may be in the future — in that case we
  // insert a 'scheduled' row and let the sweeper pick it up at the right time.
  const scheduledAt = computeScheduledAt(automation, workspaceHours)
  const dueNow = scheduledAt.getTime() <= Date.now()

  console.log('[monday-webhook] runAutomation', {
    automation_id: automation.id,
    item_id: String(itemId),
    send_delay_seconds: automation.send_delay_seconds,
    respect_business_hours: automation.respect_business_hours,
    scheduled_at: scheduledAt.toISOString(),
    now: new Date().toISOString(),
    dueNow,
  })

  // Claim the dedup slot — a lead is handled at most once per automation.
  const initialStatus = dueNow ? 'pending' : 'scheduled'
  const { error: claimErr } = await supabaseAdmin
    .from('monday_automation_sends')
    .insert({
      automation_id: automation.id,
      monday_item_id: String(itemId),
      status: initialStatus,
      scheduled_at: scheduledAt.toISOString(),
    })
  if (claimErr) {
    if (claimErr.code === '23505') {
      console.log(`[monday-webhook] skipped — automation ${automation.id} already has a send row for item ${itemId} (unique constraint)`)
      return
    }
    console.error('[monday-webhook] dedup claim error:', claimErr)
    return
  }

  if (!dueNow) {
    console.log(`[monday-webhook] automation ${automation.id} item ${itemId} → scheduled for ${scheduledAt.toISOString()}`)
    return   // sweeper will process when scheduled_at arrives
  }

  const outcome = await processAutomationItem(automation, itemId)
  await supabaseAdmin
    .from('monday_automation_sends')
    .update({
      status: outcome.status,
      detail: outcome.detail || null,
      conversation_id: outcome.conversationId || null,
      message_id: outcome.messageId || null,
    })
    .eq('automation_id', automation.id)
    .eq('monday_item_id', String(itemId))

  if (outcome.status === 'pending') {
    console.log(`[monday-webhook] item ${itemId} pending — phone not filled yet, sweeper will retry`)
  } else {
    console.log(`[monday-webhook] automation ${automation.id} item ${itemId} → ${outcome.status}`)
  }
}

export async function POST(request) {
  // Log every inbound — invaluable when Monday is silently disabling a webhook.
  console.log('[monday-webhook] inbound POST', {
    has_auth: !!request.headers.get('authorization'),
    user_agent: request.headers.get('user-agent'),
  })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 1) Registration handshake — echo the challenge.
  if (body?.challenge) {
    console.log('[monday-webhook] handshake — echoing challenge')
    return NextResponse.json({ challenge: body.challenge })
  }

  // 2) Verify authenticity. If this fails, Monday auto-disables the webhook.
  if (!(await verifySignature(request))) {
    console.warn('[monday-webhook] 401 — signature verify failed. Most likely cause: MONDAY_SIGNING_SECRET env var does not match the current Monday app\'s signing secret.')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = body?.event
  const boardId = event?.boardId
  const itemId = event?.pulseId || event?.itemId
  if (!boardId || !itemId) {
    return NextResponse.json({ ok: true })   // nothing actionable — ack so Monday doesn't retry
  }

  // 3) Run each active automation on that board.
  const { data: automations, error } = await supabaseAdmin
    .from('monday_automations')
    .select('*')
    .eq('board_id', String(boardId))
    .eq('is_active', true)

  if (error) {
    console.error('[monday-webhook] automation lookup error:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  // Load workspace business hours once (all automations on a board share a
  // workspace). Used to compute scheduled_at when any automation opts in.
  const workspaceHoursByWs = new Map()
  const wsIds = [...new Set((automations || []).map(a => a.workspace_id))]
  if (wsIds.length) {
    const { data: workspaces } = await supabaseAdmin
      .from('workspaces')
      .select('id, business_hours_enabled, business_hours_start, business_hours_end, business_hours_tz, business_days')
      .in('id', wsIds)
    for (const w of (workspaces || [])) workspaceHoursByWs.set(w.id, w)
  }

  for (const automation of automations || []) {
    await runAutomation(automation, itemId, workspaceHoursByWs.get(automation.workspace_id))
  }

  // Always 200 so Monday doesn't retry — per-item state lives in monday_automation_sends.
  return NextResponse.json({ ok: true, processed: automations?.length || 0 })
}
