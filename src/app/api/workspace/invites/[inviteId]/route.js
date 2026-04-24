import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// DELETE — revoke a pending invite
export async function DELETE(request, { params: paramsPromise }) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only owners/admins can revoke invites
    const { data: requester } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace.workspaceId)
      .eq('user_id', user.userId)
      .eq('is_active', true)
      .single()

    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      return NextResponse.json({ error: 'Only workspace owners can revoke invites' }, { status: 403 })
    }

    const params = await Promise.resolve(paramsPromise)
    const { inviteId } = params

    const { error } = await supabaseAdmin
      .from('workspace_invites')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .eq('workspace_id', workspace.workspaceId)
      .eq('status', 'pending')

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[workspace/invites DELETE]', error)
    return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 })
  }
}
