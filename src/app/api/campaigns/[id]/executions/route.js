import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { id: campaignId } = await params

    const { data: campaign, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, status, sent_count, failed_count, started_at, completed_at')
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (error || !campaign) {
      return NextResponse.json({ success: true, executions: [] })
    }

    const executions = (campaign.started_at || campaign.completed_at) ? [{
      id: campaign.id,
      executed_at: campaign.completed_at || campaign.started_at,
      sent_count: campaign.sent_count || 0,
      failed_count: campaign.failed_count || 0,
      status: campaign.status
    }] : []

    return NextResponse.json({ success: true, executions })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
