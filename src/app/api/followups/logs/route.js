// Follow-Up Logs — aggregates followup_events into one row per (lead, stage):
// scheduled time, actual send time, and a derived status. Paginated.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const PAGE = 50
const SCAN = 4000   // how many recent events to aggregate over

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10))
  const statusFilter = searchParams.get('status') || ''   // optional

  const { data: events } = await supabaseAdmin
    .from('followup_events')
    .select('conversation_id, scenario_id, stage_number, type, scheduled_for, occurred_at')
    .eq('workspace_id', workspace.workspaceId)
    .order('occurred_at', { ascending: true })
    .limit(SCAN)

  const evs = events || []

  // template_sent time per conversation; one accumulating row per stage.
  const templateAt = new Map()
  const rows = new Map()   // key conv:scenario:stage
  for (const e of evs) {
    if (e.type === 'template_sent') { templateAt.set(e.conversation_id, e.occurred_at); continue }
    if (e.stage_number == null) continue
    const key = `${e.conversation_id}:${e.scenario_id}:${e.stage_number}`
    let r = rows.get(key)
    if (!r) { r = { conversation_id: e.conversation_id, scenario_id: e.scenario_id, stage_number: e.stage_number, scheduled_for: null, sent_at: null, status: 'scheduled', last: e.occurred_at }; rows.set(key, r) }
    r.last = e.occurred_at
    const terminal = r.status === 'sent' || r.status === 'delivered'
    if (e.type === 'scheduled' || e.type === 'rescheduled') { r.scheduled_for = e.scheduled_for; if (!terminal) r.status = 'scheduled' }
    else if (e.type === 'sent') { r.sent_at = e.occurred_at; if (r.status !== 'delivered') r.status = 'sent' }
    else if (e.type === 'delivered') { if (!r.sent_at) r.sent_at = e.occurred_at; r.status = 'delivered' }
    else if (e.type === 'cancelled' || e.type === 'responded_before') { if (!terminal) r.status = 'responded_before' }
    else if (e.type === 'skipped') { if (!terminal) r.status = 'skipped' }
  }

  let all = [...rows.values()].sort((a, b) => new Date(b.last) - new Date(a.last))
  if (statusFilter) all = all.filter(r => r.status === statusFilter)

  // Resolve lead + scenario names for the current page only.
  const total = all.length
  const slice = all.slice(page * PAGE, page * PAGE + PAGE)
  const convIds = [...new Set(slice.map(r => r.conversation_id))]
  const scIds = [...new Set(slice.map(r => r.scenario_id))]

  const convMap = {}, scMap = {}
  if (convIds.length) {
    const { data: convs } = await supabaseAdmin.from('conversations').select('id, name, phone_number').in('id', convIds)
    for (const c of (convs || [])) convMap[c.id] = c
  }
  if (scIds.length) {
    const { data: scs } = await supabaseAdmin.from('scenarios').select('id, name').in('id', scIds)
    for (const s of (scs || [])) scMap[s.id] = s.name
  }

  const recipients = slice.map(r => ({
    ...r,
    lead_name: convMap[r.conversation_id]?.name || null,
    phone: convMap[r.conversation_id]?.phone_number || null,
    scenario_name: scMap[r.scenario_id] || null,
    template_sent_at: templateAt.get(r.conversation_id) || null,
  }))

  return NextResponse.json({ rows: recipients, total, page, pageSize: PAGE })
}
