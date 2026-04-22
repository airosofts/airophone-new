import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// DELETE — remove a member from the workspace
export async function DELETE(request, { params }) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { memberId } = params

    // Only owners/admins can remove members
    const { data: requester } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace.workspaceId)
      .eq('user_id', user.userId)
      .eq('is_active', true)
      .single()

    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      return NextResponse.json({ error: 'Only workspace owners can remove members' }, { status: 403 })
    }

    // Fetch the member to remove
    const { data: target } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, role')
      .eq('id', memberId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (target.role === 'owner') return NextResponse.json({ error: 'Cannot remove the workspace owner' }, { status: 403 })
    if (target.user_id === user.userId) return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 403 })

    await supabaseAdmin
      .from('workspace_members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', memberId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[workspace/members DELETE]', error)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
