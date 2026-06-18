// Sweeper for deferred AI replies (business-hours reply mode). When a lead
// messages outside business hours and the scenario only replies in-hours, the
// telnyx webhook parks a row in deferred_ai_replies with run_at = next opening.
// This endpoint fires those replies once their time arrives.
//
// Auth: Bearer CRON_SECRET. Called every minute by the followup-cron service.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { executeScenario } from '@/lib/scenario-service'

const BATCH = 50

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()
  const { data: due, error } = await supabaseAdmin
    .from('deferred_ai_replies')
    .select('id, conversation_id, scenario_id')
    .lte('run_at', nowIso)
    .order('run_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[deferred-replies] query error:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }
  if (!due || due.length === 0) return NextResponse.json({ ok: true, fired: 0 })

  let fired = 0, skipped = 0
  for (const row of due) {
    try {
      const { data: scenario } = await supabaseAdmin
        .from('scenarios').select('*').eq('id', row.scenario_id).maybeSingle()
      const { data: conversation } = await supabaseAdmin
        .from('conversations').select('*').eq('id', row.conversation_id).maybeSingle()

      // Drop the row up front so a slow/failed run can't be re-fired in a loop.
      await supabaseAdmin.from('deferred_ai_replies').delete().eq('id', row.id)

      // Skip if the scenario was deactivated, the chat was taken over manually,
      // or the lead already got a human reply since (last message outbound).
      if (!scenario || !scenario.is_active || !conversation || conversation.manual_override) { skipped++; continue }

      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('id, direction, body, from_number, to_number, created_at')
        .eq('conversation_id', row.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!lastMsg || lastMsg.direction !== 'inbound') { skipped++; continue }

      await executeScenario(scenario, lastMsg, conversation)
      fired++
    } catch (e) {
      console.error('[deferred-replies] row error:', e?.message || e)
      skipped++
    }
  }

  console.log(`[deferred-replies] fired ${fired}, skipped ${skipped}`)
  return NextResponse.json({ ok: true, fired, skipped })
}
