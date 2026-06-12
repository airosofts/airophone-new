// POST /api/push/register-device
// Stores an Expo push token for the authenticated mobile user so the backend
// can send remote push notifications (new message, incoming call) to the device.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!user?.userId || !workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token, platform } = await request.json().catch(() => ({}))
  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  // Upsert on the unique token — re-registering the same device updates its
  // workspace/user/platform and bumps updated_at.
  const { error } = await supabaseAdmin
    .from('device_push_tokens')
    .upsert(
      {
        token,
        platform: platform || null,
        user_id: user.userId,
        workspace_id: workspace.workspaceId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    )

  if (error) {
    console.error('[push/register-device]', error.message)
    return NextResponse.json({ error: 'Failed to register device' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
