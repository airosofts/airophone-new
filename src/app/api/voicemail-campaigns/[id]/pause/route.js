// Toggle a running RVM campaign between 'running' and 'paused'.
// POST → pause; the next sweeper tick sees status='paused' and skips it.
// Use /resume to flip back; the same queued rows resume from where they were.

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
    .update({ status: 'paused', paused_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .eq('status', 'running')   // can only pause a running campaign
    .select()
    .maybeSingle()

  if (error) {
    console.error('[rvm:pause]', error)
    return NextResponse.json({ error: 'Failed to pause' }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Campaign is not running' }, { status: 409 })
  }
  return NextResponse.json({ success: true, campaign: updated })
}
