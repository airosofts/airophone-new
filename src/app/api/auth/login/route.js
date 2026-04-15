import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { signToken, buildSessionCookie } from '@/lib/jwt'

export async function POST(request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // Authenticate against users table
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('password_hash', password)
      .single()

    if (userError || !userData) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (userData.is_active === false) {
      return NextResponse.json({ error: 'Account is not active' }, { status: 403 })
    }

    // Get workspace memberships
    const { data: memberships, error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        id, workspace_id, role, permissions, is_active,
        workspaces!inner (id, name, slug, messaging_profile_id, billing_group_id, is_active, settings)
      `)
      .eq('user_id', userData.id)
      .eq('is_active', true)
      .eq('workspaces.is_active', true)

    if (memberError || !memberships || memberships.length === 0) {
      return NextResponse.json({ error: 'No active workspace found' }, { status: 403 })
    }

    // Pick default workspace
    let defaultWs = memberships[0]
    if (userData.default_workspace_id) {
      const found = memberships.find(m => m.workspace_id === userData.default_workspace_id)
      if (found) defaultWs = found
    }

    // Build session payload
    const session = {
      userId: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role,
      profile_photo_url: userData.profile_photo_url || null,
      workspaceId: defaultWs.workspace_id,
      workspaceName: defaultWs.workspaces.name,
      workspaceSlug: defaultWs.workspaces.slug,
      workspaceRole: defaultWs.role,
      workspacePermissions: defaultWs.permissions,
      messagingProfileId: defaultWs.workspaces.messaging_profile_id,
      billingGroupId: defaultWs.workspaces.billing_group_id,
      availableWorkspaces: memberships.map(m => ({
        id: m.workspace_id, name: m.workspaces.name, slug: m.workspaces.slug, role: m.role,
      })),
      loginTime: new Date().toISOString(),
    }

    // Sign JWT and set cookie
    const token = await signToken({
      userId: session.userId,
      email: session.email,
      workspaceId: session.workspaceId,
      workspaceRole: session.workspaceRole,
      messagingProfileId: session.messagingProfileId,
    })

    const response = NextResponse.json({
      message: 'Login successful',
      session,
    })

    response.headers.set('Set-Cookie', buildSessionCookie(token))
    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
}
