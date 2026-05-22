// Retry sweeper for Monday automations whose lead had no phone when the
// webhook first fired (the form fills board columns a moment after item
// creation). Called on a schedule by the followup-cron service.
//
// Auth: Bearer CRON_SECRET — same shared secret the cron service uses.
//
// For each 'pending' send row: re-run processAutomationItem. If the phone has
// since been filled it sends; if the row is older than MAX_WAIT_MIN and still
// has no phone, give up and mark it 'failed'.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { processAutomationItem } from '@/lib/monday-automation'

const MAX_WAIT_MIN = 120   // stop retrying a lead whose phone never arrives
const BATCH = 100

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows, error } = await supabaseAdmin
    .from('monday_automation_sends')
    .select('id, automation_id, monday_item_id, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[process-pending] query error:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, pending: 0, sent: 0, gaveUp: 0 })
  }

  // Load the automations referenced by this batch in one go.
  const autoIds = [...new Set(rows.map(r => r.automation_id))]
  const { data: autos } = await supabaseAdmin
    .from('monday_automations')
    .select('*')
    .in('id', autoIds)
  const autoById = new Map((autos || []).map(a => [a.id, a]))

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

  return NextResponse.json({ ok: true, processed: rows.length, sent, gaveUp, stillPending })
}
