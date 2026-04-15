import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { signToken, buildSessionCookie, getSessionFromRequest } from '@/lib/jwt'

export async function GET(request) {
  try {
    // Read userId from the JWT-injected header (set by middleware)
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: memberships, error } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        id, workspace_id, role, permissions, is_active,
        workspaces!inner (id, name, slug, messaging_profile_id, billing_group_id, is_active)
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('workspaces.is_active', true)

    if (error || !memberships || memberships.length === 0) {
      return NextResponse.json({ success: false, error: 'No workspace found' }, { status: 404 })
    }

    const ws = memberships[0]

    const session = {
      workspaceId: ws.workspace_id,
      workspaceName: ws.workspaces.name,
      workspaceSlug: ws.workspaces.slug,
      workspaceRole: ws.role,
      workspacePermissions: ws.permissions,
      messagingProfileId: ws.workspaces.messaging_profile_id,
      billingGroupId: ws.workspaces.billing_group_id,
      availableWorkspaces: memberships.map(m => ({
        id: m.workspace_id, name: m.workspaces.name, slug: m.workspaces.slug, role: m.role,
      })),
    }

    // Re-sign token with updated workspace data
    const token = await signToken({
      userId,
      email: (await getSessionFromRequest(request))?.email || '',
      workspaceId: ws.workspace_id,
      workspaceRole: ws.role,
      messagingProfileId: ws.workspaces.messaging_profile_id,
    })

    const response = NextResponse.json({ success: true, session })
    response.headers.set('Set-Cookie', buildSessionCookie(token))
    return response
  } catch (error) {
    console.error('Session upgrade error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
