// Follow-Up Logs — ONE ROW PER OCCURRENCE (not merged by conversation/stage, so
// re-testing the same lead doesn't jumble runs together):
//   • every follow-up MESSAGE that sent  → a Sent/Delivered/Failed row
//   • the currently-pending stage (state) → a Scheduled row
//   • every responded_before event        → a Responded Before row
// Status is read from the actual message (the source of truth); scheduled/template
// times are matched to the nearest preceding event for that send.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const PAGE = 50
const SCAN = 4000
const FAILED = new Set(['failed', 'undelivered', 'delivery_failed', 'sending_failed'])

// Latest value in `arr` (array of ISO strings) that is <= beforeIso; else null.
function latestBefore(arr, beforeIso) {
  if (!arr || !arr.length) return null
  const before = beforeIso ? new Date(beforeIso).getTime() : Infinity
  let best = null, bestT = -Infinity
  for (const v of arr) {
    const t = new Date(v).getTime()
    if (t <= before && t > bestT) { best = v; bestT = t }
  }
  return best ?? arr[arr.length - 1]   // fall back to most recent if none precede
}

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

  const convScenario = new Map()
  const templatesByConv = new Map()   // conv → [ISO] (asc)
  const schedByStage = new Map()      // `conv:stage` → [scheduled_for ISO] (asc)
  const push = (map, key, val) => { const a = map.get(key) || []; a.push(val); map.set(key, a) }

  for (const e of (events || [])) {
    if (e.scenario_id) convScenario.set(e.conversation_id, e.scenario_id)
    if (e.type === 'template_sent') { push(templatesByConv, e.conversation_id, e.occurred_at); continue }
    if (e.stage_number == null) continue
    if (e.type === 'scheduled' || e.type === 'rescheduled') push(schedByStage, `${e.conversation_id}:${e.stage_number}`, e.scheduled_for)
  }

  const convIds = [...new Set((events || []).map(e => e.conversation_id))]
  const schedFor = (conv, stage, beforeIso) => latestBefore(schedByStage.get(`${conv}:${stage}`), beforeIso)
  const tmplFor = (conv, beforeIso) => latestBefore(templatesByConv.get(conv), beforeIso)

  const out = []

  // 1) Sent rows — one per follow-up message.
  if (convIds.length) {
    const { data: fmsgs } = await supabaseAdmin
      .from('messages')
      .select('conversation_id, followup_stage, status, created_at, error_code, error_message')
      .in('conversation_id', convIds)
      .eq('is_followup', true)
      .not('followup_stage', 'is', null)
    for (const m of (fmsgs || [])) {
      let status = 'sent', error = null
      if (m.status === 'delivered') status = 'delivered'
      else if (FAILED.has(m.status)) { status = 'failed'; error = m.error_code || m.error_message || null }
      out.push({
        conversation_id: m.conversation_id, stage_number: m.followup_stage,
        sent_at: m.created_at, scheduled_for: schedFor(m.conversation_id, m.followup_stage, m.created_at),
        status, error, template_sent_at: tmplFor(m.conversation_id, m.created_at), _sort: m.created_at,
      })
    }
  }

  // 2) Pending scheduled row — from live follow-up state (source of truth).
  if (convIds.length) {
    const { data: states } = await supabaseAdmin
      .from('conversation_followup_state')
      .select('conversation_id, scenario_id, current_stage, next_followup_at, stopped')
      .in('conversation_id', convIds)
    for (const s of (states || [])) {
      if (s.scenario_id) convScenario.set(s.conversation_id, s.scenario_id)
      if (s.stopped || !s.next_followup_at) continue
      out.push({
        conversation_id: s.conversation_id, stage_number: (s.current_stage || 0) + 1,
        sent_at: null, scheduled_for: s.next_followup_at, status: 'scheduled',
        template_sent_at: tmplFor(s.conversation_id, s.next_followup_at), _sort: s.next_followup_at,
      })
    }
  }

  // 3) Responded-before rows — a stage that was cancelled by a reply before it sent.
  for (const e of (events || [])) {
    if (e.type !== 'responded_before' && e.type !== 'cancelled') continue
    out.push({
      conversation_id: e.conversation_id, stage_number: e.stage_number,
      sent_at: null, scheduled_for: schedFor(e.conversation_id, e.stage_number, e.occurred_at),
      status: 'responded_before', template_sent_at: tmplFor(e.conversation_id, e.occurred_at), _sort: e.occurred_at,
    })
  }

  let all = out.sort((a, b) => new Date(b._sort) - new Date(a._sort))
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
    conversation_id: r.conversation_id, stage_number: r.stage_number, scheduled_for: r.scheduled_for,
    sent_at: r.sent_at, status: r.status, error: r.error || null,
    lead_name: convMap[r.conversation_id]?.name || null,
    phone: convMap[r.conversation_id]?.phone_number || null,
    scenario_name: scMap[convScenario.get(r.conversation_id)] || null,
    template_sent_at: r.template_sent_at || null,
  }))

  return NextResponse.json({ rows: recipients, total, page, pageSize: PAGE })
}
