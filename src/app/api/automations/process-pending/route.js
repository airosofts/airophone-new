// Sweeper for Monday automations. Handles two states:
//   - 'pending'   — lead had no phone yet; retry until filled or aged out.
//   - 'scheduled' — has a future scheduled_at (send delay or business hours).
//                   Process when scheduled_at <= now AND window is open.
//
// Auth: Bearer CRON_SECRET. Called by the followup-cron service.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { processAutomationItem } from '@/lib/monday-automation'
import { processRecipeRun } from '@/lib/monday-recipe-process'
import { isInBusinessHours, nextBusinessTime } from '@/lib/scheduling'

const MAX_WAIT_MIN = 120   // stop retrying a lead whose phone never arrives
// If a 'scheduled' row's scheduled_at is more than this many minutes in the
// past, mark it failed instead of sending. Protects against burst-sends when
// the sweeper recovers after a long outage — we'd rather a lead get no text
// than a "Hey John!" message 90 minutes after they filled the form.
const STALE_SCHEDULED_MIN = 60
const BATCH = 100

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    // Log loudly so a misconfigured cron is visible — without this, an
    // auth mismatch silently means nothing ever gets processed.
    console.warn('[process-pending] 401 — auth header did not match CRON_SECRET', {
      hasSecret: !!secret,
      hasAuth: !!auth,
      authPrefix: auth ? auth.slice(0, 10) + '…' : null,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Pull both 'pending' rows and 'scheduled' rows whose time has arrived.
  const nowIso = new Date().toISOString()
  const { data: rows, error } = await supabaseAdmin
    .from('monday_automation_sends')
    .select('id, automation_id, monday_item_id, created_at, status, scheduled_at')
    .in('status', ['pending', 'scheduled'])
    .or(`status.eq.pending,scheduled_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[process-pending] query error:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    // Also probe what's queued so we can see why nothing's being processed.
    const { data: queued } = await supabaseAdmin
      .from('monday_automation_sends')
      .select('id, status, scheduled_at, created_at')
      .in('status', ['pending', 'scheduled'])
      .order('created_at', { ascending: false })
      .limit(5)
    console.log('[process-pending] nothing due', { now: nowIso, queued })
    return NextResponse.json({ ok: true, pending: 0, sent: 0, gaveUp: 0, queued: queued?.length || 0 })
  }
  console.log('[process-pending] picked up rows', rows.map(r => ({ id: r.id, status: r.status, scheduled_at: r.scheduled_at })))

  // Load automations + their workspace business hours in one go.
  const autoIds = [...new Set(rows.map(r => r.automation_id))]
  const { data: autos } = await supabaseAdmin
    .from('monday_automations')
    .select('*')
    .in('id', autoIds)
  const autoById = new Map((autos || []).map(a => [a.id, a]))

  const wsIds = [...new Set((autos || []).map(a => a.workspace_id))]
  const wsHoursById = new Map()
  if (wsIds.length) {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('id, business_hours_enabled, business_hours_start, business_hours_end, business_hours_tz, business_days')
      .in('id', wsIds)
    for (const w of (ws || [])) wsHoursById.set(w.id, w)
  }

  let sent = 0, gaveUp = 0, stillPending = 0
  const cutoff = Date.now() - MAX_WAIT_MIN * 60 * 1000

  for (const row of rows) {
    const automation = autoById.get(row.automation_id)
    if (!automation || !automation.is_active) {
      // Automation deleted or paused — stop retrying.
      await supabaseAdmin.from('monday_automation_sends')
        .update({ status: 'failed', detail: 'Automation removed or paused' })
        .eq('id', row.id)
      gaveUp++
      continue
    }

    // Staleness guard: a scheduled row whose target time is long past — almost
    // certainly because the sweeper was down — should be dropped rather than
    // surprise-fired. Pending rows (no phone yet) use the separate aging logic
    // below; they can wait the full MAX_WAIT_MIN.
    if (row.status === 'scheduled' && row.scheduled_at) {
      const ageMin = (Date.now() - new Date(row.scheduled_at).getTime()) / 60000
      if (ageMin > STALE_SCHEDULED_MIN) {
        await supabaseAdmin.from('monday_automation_sends')
          .update({ status: 'failed', detail: `Stale: scheduled_at was ${Math.round(ageMin)} min in the past (sweeper outage?)` })
          .eq('id', row.id)
        console.warn(`[process-pending] dropped stale row ${row.id} — ${Math.round(ageMin)} min past scheduled_at`)
        gaveUp++
        continue
      }
    }

    // Business-hours check for scheduled rows: if the time arrived but the
    // window is closed (or it's a non-business day), push scheduled_at forward
    // to the next window open and leave the row alone for now.
    if (row.status === 'scheduled' && automation.respect_business_hours) {
      const hours = wsHoursById.get(automation.workspace_id)
      if (hours && !isInBusinessHours(new Date(), hours)) {
        const nextAt = nextBusinessTime(new Date(), hours)
        await supabaseAdmin.from('monday_automation_sends')
          .update({ scheduled_at: nextAt.toISOString() })
          .eq('id', row.id)
        stillPending++
        continue
      }
    }

    const outcome = await processAutomationItem(automation, row.monday_item_id)

    if (outcome.status === 'pending') {
      // Still no phone — give up if the row has aged out.
      if (new Date(row.created_at).getTime() < cutoff) {
        await supabaseAdmin.from('monday_automation_sends')
          .update({ status: 'failed', detail: `Phone never filled within ${MAX_WAIT_MIN} min` })
          .eq('id', row.id)
        gaveUp++
      } else {
        stillPending++
      }
      continue
    }

    await supabaseAdmin.from('monday_automation_sends')
      .update({
        status: outcome.status,
        detail: outcome.detail || null,
        conversation_id: outcome.conversationId || null,
        message_id: outcome.messageId || null,
      })
      .eq('id', row.id)
    if (outcome.status === 'sent') sent++
    else gaveUp++   // 'failed'
  }

  // ── Recipe runs ───────────────────────────────────────────────────────────
  // Retry pending monday_recipe_runs the same way: when a new monday item is
  // created, the form may fill the phone column 10–30 seconds later. The
  // execute endpoint marks those rows 'pending'; we pick them up here and
  // retry until the phone fills or MAX_WAIT_MIN elapses.
  const recipeResult = await processPendingRecipeRuns({ cutoff })

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    sent,
    gaveUp,
    stillPending,
    recipe: recipeResult,
  })
}

async function processPendingRecipeRuns({ cutoff }) {
  // Pick up two kinds of rows:
  //   - 'pending'   → send now / phone-fill retry
  //   - 'scheduled' → a "wait N minutes" delay whose scheduled_at has passed
  const nowIso = new Date().toISOString()
  const { data: rows, error } = await supabaseAdmin
    .from('monday_recipe_runs')
    .select('id, integration_id, monday_item_id, monday_board_id, workspace_id, created_at, status, scheduled_at')
    .in('status', ['pending', 'scheduled'])
    .or(`status.eq.pending,scheduled_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[process-pending] recipe query error:', error)
    return { error: error.message }
  }
  if (!rows || rows.length === 0) return { processed: 0, sent: 0, gaveUp: 0, stillPending: 0 }

  // Load the matching subscriptions in one go — input_fields lives there.
  const integrationIds = [...new Set(rows.map(r => r.integration_id))]
  const { data: subs } = await supabaseAdmin
    .from('monday_recipe_subscriptions')
    .select('integration_id, input_fields')
    .in('integration_id', integrationIds)
  const subByIntegrationId = new Map((subs || []).map(s => [s.integration_id, s]))

  let sent = 0, gaveUp = 0, stillPending = 0

  for (const row of rows) {
    const sub = subByIntegrationId.get(row.integration_id)
    if (!sub?.input_fields) {
      // Subscription missing — recipe was likely removed in monday. Give up.
      await supabaseAdmin.from('monday_recipe_runs')
        .update({ status: 'failed', detail: 'Subscription missing', updated_at: new Date().toISOString() })
        .eq('id', row.id)
      gaveUp++
      continue
    }

    const outcome = await processRecipeRun({
      workspaceId: row.workspace_id,
      boardId:     row.monday_board_id,
      itemId:      row.monday_item_id,
      inputFields: sub.input_fields,
    })

    if (outcome.status === 'pending') {
      // Still no phone — give up if aged out, otherwise leave alone.
      if (new Date(row.created_at).getTime() < cutoff) {
        await supabaseAdmin.from('monday_recipe_runs')
          .update({
            status: 'failed',
            detail: `Phone never filled within ${MAX_WAIT_MIN} min`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        gaveUp++
      } else {
        stillPending++
      }
      continue
    }

    await supabaseAdmin.from('monday_recipe_runs')
      .update({
        status: outcome.status,
        detail: outcome.detail || null,
        conversation_id: outcome.conversationId || null,
        message_id: outcome.messageId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    if (outcome.status === 'sent') sent++
    else gaveUp++
  }

  console.log('[process-pending] recipe runs processed', { picked: rows.length, sent, gaveUp, stillPending })
  return { processed: rows.length, sent, gaveUp, stillPending }
}
