// POST /api/presence/heartbeat — mark the current user as "active now".
// Called on a short interval by the client while a dashboard tab is open. Upserts
// user_presence (the realtime source); "online" is derived as last_seen within
// the presence window (see @/lib/presence). Also mirrors to users.last_seen for
// any legacy readers.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('user_presence')
    .upsert(
      { user_id: user.userId, workspace_id: workspace?.workspaceId || null, last_seen: now, updated_at: now },
      { onConflict: 'user_id' }
    )
  // Best-effort legacy mirror; ignore failures.
  await supabaseAdmin.from('users').update({ last_seen: now }).eq('id', user.userId).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}
