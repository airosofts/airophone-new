// Per-recipient breakdown for an RVM campaign — used by the details modal to
// show each number, its delivery status, and the time it was sent/delivered.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: campaignId } = await params

  const { data, error } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('phone, status, sent_at, delivered_at, error, created_at')
    .eq('campaign_id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .order('sent_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(5000)

  if (error) {
    console.error('[rvm:recipients]', error)
    return NextResponse.json({ error: 'Failed to load recipients' }, { status: 500 })
  }

  return NextResponse.json({ success: true, recipients: data || [] })
}
