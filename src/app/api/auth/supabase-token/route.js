import { NextResponse } from 'next/server'
import { mintSupabaseToken } from '@/lib/supabaseToken'

// Returns a short-lived Supabase JWT scoped to the caller's workspace (Path A).
// Auth is enforced by middleware, which injects x-user-id / x-workspace-id.
export async function GET(request) {
  const userId = request.headers.get('x-user-id')
  const workspaceId = request.headers.get('x-workspace-id')
  if (!userId || !workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { token, expiresAt } = await mintSupabaseToken({
      userId,
      workspaceId,
      secret: process.env.SUPABASE_JWT_SECRET,
      ttlSeconds: 3600,
    })
    return NextResponse.json({ token, expiresAt })
  } catch (err) {
    console.error('supabase-token mint failed:', err.message)
    return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 })
  }
}
