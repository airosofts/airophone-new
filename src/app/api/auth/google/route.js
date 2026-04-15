import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { signToken, buildSessionCookie } from '@/lib/jwt'

function generateSlug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

export async function POST(request) {
  try {
    const { code, redirect_uri } = await request.json()

    if (!code || !redirect_uri) {
      return NextResponse.json({ error: 'Authorization code and redirect_uri are required' }, { status: 400 })
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = redirect_uri

    // 1. Exchange authorization code for tokens directly with Google
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Google token exchange failed:', tokenData)
      return NextResponse.json({ error: 'Failed to verify Google sign-in' }, { status: 401 })
    }

    // 2. Get user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })

    const googleUser = await userInfoRes.json()

    if (!userInfoRes.ok || !googleUser.email) {
      console.error('Failed to get Google user info:', googleUser)
      return NextResponse.json({ error: 'Failed to get your Google profile' }, { status: 401 })
    }

    const email = googleUser.email.toLowerCase().trim()
    const googleName = googleUser.name || email.split('@')[0]
    const avatarUrl = googleUser.picture || null

    // 3. Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    if (existingUser) {
      // ── EXISTING USER: build session ──
      if (avatarUrl && !existingUser.profile_photo_url) {
        await supabaseAdmin.from('users').update({ profile_photo_url: avatarUrl }).eq('id', existingUser.id)
      }

      const { data: memberships, error: memberError } = await supabaseAdmin
        .from('workspace_members')
        .select(`
          id, workspace_id, role, permissions, is_active,
          workspaces!inner (id, name, slug, messaging_profile_id, billing_group_id, is_active)
        `)
        .eq('user_id', existingUser.id)
        .eq('is_active', true)
        .eq('workspaces.is_active', true)

      if (memberError || !memberships || memberships.length === 0) {
        return NextResponse.json({ error: 'No active workspace found for this account' }, { status: 403 })
      }

      let defaultWs = memberships[0]
      if (existingUser.default_workspace_id) {
        const found = memberships.find(m => m.workspace_id === existingUser.default_workspace_id)
        if (found) defaultWs = found
      }

      const session = {
        userId: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        role: existingUser.role,
        profile_photo_url: existingUser.profile_photo_url || avatarUrl,
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

      const token = await signToken({
        userId: session.userId, email: session.email,
        workspaceId: session.workspaceId, workspaceRole: session.workspaceRole,
        messagingProfileId: session.messagingProfileId,
      })
      const res = NextResponse.json({ success: true, session, isNewUser: false })
      res.headers.set('Set-Cookie', buildSessionCookie(token))
      return res
    }

    // ── NEW USER: create user + workspace + membership + wallet ──
    const { data: newUser, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        password_hash: `google_oauth_${Date.now()}`,
        name: googleName,
        profile_photo_url: avatarUrl,
        role: 'user',
        is_active: true,
      })
      .select()
      .single()

    if (userError) {
      console.error('Error creating user:', userError)
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    const workspaceName = `${googleName}'s Workspace`
    const slug = generateSlug(workspaceName)

    const { data: newWorkspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .insert({ name: workspaceName, slug, is_active: true, created_by: newUser.id })
      .select()
      .single()

    if (wsError) {
      console.error('Error creating workspace:', wsError)
      await supabaseAdmin.from('users').delete().eq('id', newUser.id)
      return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
    }

    await supabaseAdmin
      .from('workspace_members')
      .insert({ workspace_id: newWorkspace.id, user_id: newUser.id, role: 'owner', is_active: true })

    await supabaseAdmin
      .from('users')
      .update({ default_workspace_id: newWorkspace.id })
      .eq('id', newUser.id)

    await supabaseAdmin
      .from('wallets')
      .insert({ user_id: newUser.id, workspace_id: newWorkspace.id, credits: 0, balance: 0, currency: 'USD' })

    const session = {
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      profile_photo_url: avatarUrl,
      workspaceId: newWorkspace.id,
      workspaceName: newWorkspace.name,
      workspaceSlug: newWorkspace.slug,
      workspaceRole: 'owner',
      workspacePermissions: {},
      messagingProfileId: null,
      billingGroupId: null,
      availableWorkspaces: [{
        id: newWorkspace.id, name: newWorkspace.name, slug: newWorkspace.slug, role: 'owner',
      }],
      loginTime: new Date().toISOString(),
    }

    const token = await signToken({
      userId: session.userId, email: session.email,
      workspaceId: session.workspaceId, workspaceRole: session.workspaceRole,
      messagingProfileId: session.messagingProfileId,
    })
    const res = NextResponse.json({ success: true, session, isNewUser: true })
    res.headers.set('Set-Cookie', buildSessionCookie(token))
    return res
  } catch (error) {
    console.error('Google auth error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
