// Flip a paused RVM campaign back to 'running'. The queued send rows in
// voicemail_campaign_sends are untouched; the sweeper picks them up next
// tick (worst case ~60s latency).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: campaignId } = await params

  const { data: updated, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .update({ status: 'running', paused_at: null, paused_reason: null })
    .eq('id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .eq('status', 'paused')
    .select()
    .maybeSingle()

  if (error) {
    console.error('[rvm:resume]', error)
    return NextResponse.json({ error: 'Failed to resume' }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Campaign is not paused' }, { status: 409 })
  }
  return NextResponse.json({ success: true, campaign: updated })
}
