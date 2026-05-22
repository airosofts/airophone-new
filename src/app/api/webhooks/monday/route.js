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

async function runAutomation(automation, itemId) {
  // Claim the dedup slot first — a lead is handled at most once per automation.
  // Status starts 'pending'; processAutomationItem resolves it to sent/pending/failed.
  const { error: claimErr } = await supabaseAdmin
    .from('monday_automation_sends')
    .insert({ automation_id: automation.id, monday_item_id: String(itemId), status: 'pending' })
  if (claimErr) {
    if (claimErr.code === '23505') return   // already claimed (sent, pending, or failed)
    console.error('[monday-webhook] dedup claim error:', claimErr)
    return
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
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 1) Registration handshake — echo the challenge.
  if (body?.challenge) {
    return NextResponse.json({ challenge: body.challenge })
  }

  // 2) Verify authenticity.
  if (!(await verifySignature(request))) {
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

  for (const automation of automations || []) {
    await runAutomation(automation, itemId)
  }

  // Always 200 so Monday doesn't retry — per-item state lives in monday_automation_sends.
  return NextResponse.json({ ok: true, processed: automations?.length || 0 })
}
