import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// DELETE /api/api-keys/[id]
// Revoke (soft-delete) an API key. The key immediately stops working.
export async function DELETE(request, { params }) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)

  if (!user || !workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // Verify this key belongs to the current user + workspace before revoking
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('api_keys')
    .select('id')
    .eq('id', id)
    .eq('workspace_id', workspace.workspaceId)
    .eq('user_id', user.userId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  const permanent = new URL(request.url).searchParams.get('permanent') === 'true'

  if (permanent) {
    const { error } = await supabaseAdmin
      .from('api_keys')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting API key:', error)
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'API key deleted' })
  }

  const { error } = await supabaseAdmin
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', id)

  if (error) {
    console.error('Error revoking API key:', error)
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: 'API key revoked' })
}
