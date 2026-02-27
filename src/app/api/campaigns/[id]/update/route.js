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
    const { name, message } = body

    const updateData = {}
    if (name !== undefined) updateData.name = name.trim()
    if (message !== undefined) updateData.message_template = message.trim()

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(updateData)
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Failed to update campaign', details: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, campaign: data })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
