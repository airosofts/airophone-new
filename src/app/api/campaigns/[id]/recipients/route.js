// Per-recipient view for an SMS campaign — paginated. For queued recipients we
// compute the EXPECTED send time from the campaign's schedule (throttle, daily
// cap, send windows/days, scheduled start) via estimateSendSchedule. Sent rows
// carry their actual sent_at.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import { estimateSendSchedule } from '@/lib/scheduling'

const PAGE = 100

export async function GET(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const status = (searchParams.get('status') || 'queued')   // 'queued' | 'sent' | 'failed'
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10))

  const { data: c } = await supabaseAdmin
    .from('campaigns')
    .select('id, status, scheduled_at, throttle_count, throttle_window_seconds, send_windows, send_timezone, send_days, daily_cap, sent_count, failed_count, total_recipients, cycle, recurring')
    .eq('id', id).eq('workspace_id', workspace.workspaceId).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { count: total } = await supabaseAdmin
    .from('campaign_messages').select('id', { count: 'exact', head: true })
    .eq('campaign_id', id).eq('status', status)

  const from = page * PAGE
  const { data: rows } = await supabaseAdmin
    .from('campaign_messages')
    .select('id, to_number, body, status, sent_at, error_message')
    .eq('campaign_id', id).eq('status', status)
    .order('created_at', { ascending: true })
    .range(from, from + PAGE - 1)

  let recipients = rows || []
  if (status === 'queued') {
    // Queued rows are ordered by created_at, so `from + i` is the recipient's
    // position in the remaining queue. Compute ETAs up to the end of this page.
    const startMs = Math.max(Date.now(), c.scheduled_at ? new Date(c.scheduled_at).getTime() : 0)
    const need = from + recipients.length
    const eta = need > 0
      ? estimateSendSchedule(need, startMs, c.throttle_count, c.throttle_window_seconds, c.send_windows, c.send_timezone || 'America/New_York', c.daily_cap, c.send_days)
      : []
    recipients = recipients.map((r, i) => ({ ...r, eta: eta[from + i] || null }))
  }

  return NextResponse.json({
    recipients, total: total || 0, page, pageSize: PAGE,
    campaign: {
      status: c.status, sent_count: c.sent_count || 0, failed_count: c.failed_count || 0,
      total_recipients: c.total_recipients || 0, cycle: c.cycle || 1, recurring: !!c.recurring,
    },
  })
}
