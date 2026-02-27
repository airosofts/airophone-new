import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { id: campaignId } = await params
    const body = await request.json()
    const { is_paused } = body

    const newStatus = is_paused ? 'paused' : 'draft'

    const { error } = await supabaseAdmin
      .from('campaigns')
      .update({ status: newStatus })
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)

    if (error) {
      return NextResponse.json({ error: 'Failed to update campaign', details: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
