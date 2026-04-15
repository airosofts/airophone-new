import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { signToken, buildSessionCookie } from '@/lib/jwt'

function generateSlug(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

export async function POST(request) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Email, password, and name are required' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // Check if email already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Create user (storing password as-is to match existing system)
    const { data: newUser, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: password,
        name: name.trim(),
        role: 'user',
        is_active: true,
      })
      .select()
      .single()

    if (userError) {
      console.error('Error creating user:', userError)
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    // Create workspace
    const workspaceName = `${name.trim()}'s Workspace`
    const slug = generateSlug(workspaceName)

    const { data: newWorkspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name: workspaceName,
        slug,
        is_active: true,
        created_by: newUser.id,
      })
      .select()
      .single()

    if (wsError) {
      console.error('Error creating workspace:', wsError)
      // Cleanup: delete orphaned user
      await supabaseAdmin.from('users').delete().eq('id', newUser.id)
      return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
    }

    // Create workspace membership
    const { error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: newWorkspace.id,
        user_id: newUser.id,
        role: 'owner',
        is_active: true,
      })

    if (memberError) {
      console.error('Error creating membership:', memberError)
      await supabaseAdmin.from('workspaces').delete().eq('id', newWorkspace.id)
      await supabaseAdmin.from('users').delete().eq('id', newUser.id)
      return NextResponse.json({ error: 'Failed to set up workspace membership' }, { status: 500 })
    }

    // Set default workspace
    await supabaseAdmin
      .from('users')
      .update({ default_workspace_id: newWorkspace.id })
      .eq('id', newUser.id)

    // Create wallet
    await supabaseAdmin
      .from('wallets')
      .insert({ user_id: newUser.id, workspace_id: newWorkspace.id, credits: 0, balance: 0, currency: 'USD' })

    // Build session (same shape as loginWithEmailPassword)
    const session = {
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      workspaceId: newWorkspace.id,
      workspaceName: newWorkspace.name,
      workspaceSlug: newWorkspace.slug,
      workspaceRole: 'owner',
      workspacePermissions: {},
      messagingProfileId: newWorkspace.messaging_profile_id || null,
      billingGroupId: newWorkspace.billing_group_id || null,
      availableWorkspaces: [{
        id: newWorkspace.id,
        name: newWorkspace.name,
        slug: newWorkspace.slug,
        role: 'owner',
      }],
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

    const response = NextResponse.json({ success: true, session })
    response.headers.set('Set-Cookie', buildSessionCookie(token))
    return response
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
