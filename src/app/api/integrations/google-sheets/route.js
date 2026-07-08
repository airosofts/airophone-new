// Connection status + disconnect for the Google Sheets integration.
//   GET    /api/integrations/google-sheets  → { connected, account_name, ... }
//   DELETE /api/integrations/google-sheets  → removes the row

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('workspace_integrations')
    .select('account_id, account_name, connected_at, last_synced_at')
    .eq('workspace_id', user.workspaceId)
    .eq('provider', 'google_sheets')
    .maybeSingle()

  if (error) {
    console.error('[integrations/google-sheets GET] db error:', error)
    return NextResponse.json({ error: 'Failed to read integration' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ connected: false })
  }

  return NextResponse.json({
    connected: true,
    account_id: data.account_id,
    account_name: data.account_name,
    connected_at: data.connected_at,
    last_synced_at: data.last_synced_at,
  })
}

export async function DELETE(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabaseAdmin
    .from('workspace_integrations')
    .delete()
    .eq('workspace_id', user.workspaceId)
    .eq('provider', 'google_sheets')

  if (error) {
    console.error('[integrations/google-sheets DELETE] db error:', error)
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
