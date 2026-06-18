// Follow-Up Logs — one row per (lead, stage). The SENT/DELIVERED/FAILED status
// comes from the actual follow-up MESSAGE row (is_followup=true, updated by the
// Telnyx delivery webhooks) — the message is the source of truth. Events supply
// the scheduled time, "responded before", and template-sent time.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const PAGE = 50
const SCAN = 4000
const FAILED = new Set(['failed', 'undelivered', 'delivery_failed', 'sending_failed'])

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10))
  const statusFilter = searchParams.get('status') || ''

  const { data: events } = await supabaseAdmin
    .from('followup_events')
    .select('conversation_id, scenario_id, stage_number, type, scheduled_for, occurred_at')
    .eq('workspace_id', workspace.workspaceId)
    .order('occurred_at', { ascending: true })
    .limit(SCAN)

  const templateAt = new Map()
  const convScenario = new Map()
  const rows = new Map()   // key conv:stage → { ..., scheduled_for, responded, skipped, last }
  const rowKey = (c, s) => `${c}:${s}`
  const ensure = (conv, stage, at) => {
    const k = rowKey(conv, stage)
    let r = rows.get(k)
    if (!r) { r = { conversation_id: conv, stage_number: stage, scheduled_for: null, sent_at: null, responded: false, skipped: false, last: at }; rows.set(k, r) }
    if (at && new Date(at) > new Date(r.last)) r.last = at
    return r
  }

  for (const e of (events || [])) {
    if (e.scenario_id) convScenario.set(e.conversation_id, e.scenario_id)
    if (e.type === 'template_sent') { templateAt.set(e.conversation_id, e.occurred_at); continue }
    if (e.stage_number == null) continue
    const r = ensure(e.conversation_id, e.stage_number, e.occurred_at)
    if (e.type === 'scheduled' || e.type === 'rescheduled') r.scheduled_for = e.scheduled_for
    else if (e.type === 'responded_before' || e.type === 'cancelled') r.responded = true
    else if (e.type === 'skipped') r.skipped = true
  }

  // Authoritative status from the follow-up MESSAGE rows.
  const convIds = [...new Set([...rows.values()].map(r => r.conversation_id))]
  const msgByKey = new Map()
  if (convIds.length) {
    const { data: fmsgs } = await supabaseAdmin
      .from('messages')
      .select('conversation_id, followup_stage, status, created_at, error_code, error_message')
      .in('conversation_id', convIds)
      .eq('is_followup', true)
      .not('followup_stage', 'is', null)
    for (const m of (fmsgs || [])) {
      const k = rowKey(m.conversation_id, m.followup_stage)
      msgByKey.set(k, m)
      // A sent message may exist with no event (e.g. the 'sent' event wasn't logged).
      ensure(m.conversation_id, m.followup_stage, m.created_at)
    }
  }

  // The CURRENTLY-pending stage comes from the live follow-up state — the source
  // of truth for what's queued. This surfaces the next scheduled stage even when
  // its 'scheduled' event wasn't logged (so stage 2+ shows as Scheduled).
  if (convIds.length) {
    const { data: states } = await supabaseAdmin
      .from('conversation_followup_state')
      .select('conversation_id, scenario_id, current_stage, next_followup_at, stopped')
      .in('conversation_id', convIds)
    for (const s of (states || [])) {
      if (s.scenario_id) convScenario.set(s.conversation_id, s.scenario_id)
      if (s.stopped || !s.next_followup_at) continue
      const pendingStage = (s.current_stage || 0) + 1
      if (msgByKey.has(rowKey(s.conversation_id, pendingStage))) continue   // already sent
      const r = ensure(s.conversation_id, pendingStage, s.next_followup_at)
      if (!r.scheduled_for) r.scheduled_for = s.next_followup_at
    }
  }

  // Derive each row's final status.
  for (const r of rows.values()) {
    const m = msgByKey.get(rowKey(r.conversation_id, r.stage_number))
    if (m) {
      r.sent_at = m.created_at
      if (m.status === 'delivered') r.status = 'delivered'
      else if (FAILED.has(m.status)) { r.status = 'failed'; r.error = m.error_code || m.error_message || null }
      else r.status = 'sent'
    } else if (r.responded) r.status = 'responded_before'
    else if (r.skipped) r.status = 'skipped'
    else r.status = 'scheduled'
  }

  let all = [...rows.values()].sort((a, b) => new Date(b.last) - new Date(a.last))
  if (statusFilter) all = all.filter(r => r.status === statusFilter)

  const total = all.length
  const slice = all.slice(page * PAGE, page * PAGE + PAGE)
  const cIds = [...new Set(slice.map(r => r.conversation_id))]
  const sIds = [...new Set(slice.map(r => convScenario.get(r.conversation_id)).filter(Boolean))]

  const convMap = {}, scMap = {}
  if (cIds.length) {
    const { data: convs } = await supabaseAdmin.from('conversations').select('id, name, phone_number').in('id', cIds)
    for (const c of (convs || [])) convMap[c.id] = c
  }
  if (sIds.length) {
    const { data: scs } = await supabaseAdmin.from('scenarios').select('id, name').in('id', sIds)
    for (const s of (scs || [])) scMap[s.id] = s.name
  }

  const recipients = slice.map(r => ({
    ...r,
    lead_name: convMap[r.conversation_id]?.name || null,
    phone: convMap[r.conversation_id]?.phone_number || null,
    scenario_name: scMap[convScenario.get(r.conversation_id)] || null,
    template_sent_at: templateAt.get(r.conversation_id) || null,
  }))

  return NextResponse.json({ rows: recipients, total, page, pageSize: PAGE })
}
