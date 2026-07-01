// GET /api/presence — initial presence snapshot for the workspace.
// Returns { presence: { [userId]: last_seen } }. The client seeds from this, then
// keeps it live via a Supabase Realtime subscription on user_presence.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ presence: {} })
  }
  const { data } = await supabaseAdmin
    .from('user_presence')
    .select('user_id, last_seen')
    .eq('workspace_id', workspace.workspaceId)

  const presence = {}
  for (const r of (data || [])) presence[r.user_id] = r.last_seen
  return NextResponse.json({ presence })
}
