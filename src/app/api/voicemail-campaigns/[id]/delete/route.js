import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data: campaign } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (campaign.status === 'running') {
    return NextResponse.json({ error: 'Cannot delete a running campaign' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.workspaceId)

  if (error) {
    console.error('[voicemail-campaigns:delete]', error)
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
