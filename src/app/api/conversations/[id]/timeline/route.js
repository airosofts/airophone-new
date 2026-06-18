// Per-lead follow-up timeline — conversation creation + every follow-up event,
// chronological. Feeds the timeline panel in the conversation details.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, created_at, workspace_id')
    .eq('id', id).eq('workspace_id', workspace.workspaceId).maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: events } = await supabaseAdmin
    .from('followup_events')
    .select('type, stage_number, scheduled_for, occurred_at')
    .eq('conversation_id', id)
    .order('occurred_at', { ascending: true })

  const items = [{ type: 'created', label: 'Lead created', at: conv.created_at }]
  for (const e of (events || [])) {
    const s = e.stage_number
    let label
    switch (e.type) {
      case 'template_sent':     label = 'Initial message sent'; break
      case 'scheduled':         label = `Follow-up #${s} scheduled`; break
      case 'rescheduled':       label = `Follow-up #${s} rescheduled (outside hours)`; break
      case 'sent':              label = `Follow-up #${s} sent`; break
      case 'delivered':         label = `Follow-up #${s} delivered`; break
      case 'responded_before':  label = 'Lead replied — follow-ups cancelled'; break
      case 'cancelled':         label = 'Follow-up sequence cancelled'; break
      case 'skipped':           label = `Follow-up #${s} skipped`; break
      default:                  label = e.type
    }
    items.push({ type: e.type, label, at: e.occurred_at, scheduled_for: e.scheduled_for, stage_number: s })
  }

  return NextResponse.json({ items })
}
