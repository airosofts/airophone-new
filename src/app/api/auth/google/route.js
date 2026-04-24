import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { signToken, buildSessionCookie } from '@/lib/jwt'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const logoUrl = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'

async function sendWelcomeEmail(email, name) {
  const firstName = name?.split(' ')[0] || name || 'there'
  await resend.emails.send({
    from: 'AiroPhone <noreply@airophone.com>',
    to: email,
    subject: `Welcome to AiroPhone, ${firstName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#F7F6F3;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #E3E1DB;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(19,18,16,0.04);">
    <div style="padding:24px 32px;border-bottom:1px solid #E3E1DB;">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:10px;vertical-align:middle;"><img src="${logoUrl}" width="30" height="30" alt="AiroPhone" style="display:block;border-radius:7px;" /></td>
        <td style="vertical-align:middle;"><span style="font-size:15px;font-weight:600;color:#131210;letter-spacing:-0.02em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">AiroPhone</span></td>
      </tr></table>
    </div>
    <div style="padding:36px 32px 32px;">
      <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:500;color:#D63B1F;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">Welcome aboard</div>
      <h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.2;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">Hey ${firstName}, you&rsquo;re all set!</h1>
      <p style="margin:0 0 24px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">Welcome to AiroPhone. Your account is ready and your workspace has been created. We&rsquo;re excited to have you here.</p>
      <div style="background:#F7F6F3;border:1px solid #E3E1DB;border-radius:10px;padding:18px 20px;margin-bottom:28px;">
        <p style="margin:0 0 10px;font-size:13px;font-weight:500;color:#131210;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">A quick heads up on your number</p>
        <p style="margin:0;font-size:13px;font-weight:300;color:#5C5A55;line-height:1.6;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">Once you pick a phone number, it usually takes around 10 minutes for SMS to become fully active. Calls work immediately, and we&rsquo;ll send you an email as soon as SMS is ready.</p>
      </div>
      <a href="https://app.airophone.com/inbox" style="display:block;background:#D63B1F;color:#FFFFFF;text-align:center;padding:13px 24px;border-radius:9px;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.01em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">Go to your inbox</a>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #E3E1DB;background:#F7F6F3;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;letter-spacing:0.04em;">&copy; 2025 AIROSOFTS LLC</td>
        <td style="text-align:right;"><a href="https://airophone.com" style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;text-decoration:none;letter-spacing:0.04em;">airophone.com</a></td>
      </tr></table>
    </div>
  </div>
</body>
</html>`,
  }).catch(err => console.warn('[google-auth] Welcome email failed (non-critical):', err.message))
}

function generateSlug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

export async function POST(request) {
  try {
    const { code, redirect_uri, inviteWorkspaceId, inviteRole } = await request.json()

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

      // If coming from an invite link, switch to the invited workspace
      if (inviteWorkspaceId) {
        const alreadyMember = memberships.find(m => m.workspace_id === inviteWorkspaceId)
        if (!alreadyMember) {
          // Add to invited workspace
          const { data: invitedWs } = await supabaseAdmin
            .from('workspaces')
            .select('id, name, slug, messaging_profile_id, billing_group_id')
            .eq('id', inviteWorkspaceId)
            .single()
          if (invitedWs) {
            await supabaseAdmin.from('workspace_members').insert({
              workspace_id: invitedWs.id,
              user_id: existingUser.id,
              role: inviteRole || 'member',
              is_active: true,
            })
            // Best-effort mark invite accepted
            await supabaseAdmin
              .from('workspace_invites')
              .update({ status: 'accepted', updated_at: new Date().toISOString() })
              .eq('workspace_id', invitedWs.id)
              .eq('email', email)
              .eq('status', 'pending')
            // Switch default workspace
            await supabaseAdmin.from('users').update({ default_workspace_id: invitedWs.id }).eq('id', existingUser.id)
            // Add to memberships list for session
            memberships.push({
              workspace_id: invitedWs.id, role: inviteRole || 'member', permissions: {},
              workspaces: invitedWs,
            })
          }
        }
        // Switch active workspace to invited one
        const invitedMembership = memberships.find(m => m.workspace_id === inviteWorkspaceId)
        if (invitedMembership) {
          await supabaseAdmin.from('users').update({ default_workspace_id: inviteWorkspaceId }).eq('id', existingUser.id)
        }
      }

      let defaultWs = memberships[0]
      const targetWsId = inviteWorkspaceId || existingUser.default_workspace_id
      if (targetWsId) {
        const found = memberships.find(m => m.workspace_id === targetWsId)
        if (found) defaultWs = found
      }

      const session = {
        userId: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        role: existingUser.role,
        auth_provider: 'google',
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

    // ── NEW USER: create user ──
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

    let workspaceId, workspaceName, workspaceSlug, workspaceRole, messagingProfileId, billingGroupId
    let isInvited = false

    // If invite params provided, join that workspace instead of creating one
    if (inviteWorkspaceId) {
      const { data: invitedWs } = await supabaseAdmin
        .from('workspaces')
        .select('id, name, slug, messaging_profile_id, billing_group_id')
        .eq('id', inviteWorkspaceId)
        .single()

      if (invitedWs) {
        await supabaseAdmin.from('workspace_members').insert({
          workspace_id: invitedWs.id,
          user_id: newUser.id,
          role: inviteRole || 'member',
          is_active: true,
        })
        // Best-effort mark invite accepted
        await supabaseAdmin
          .from('workspace_invites')
          .update({ status: 'accepted', updated_at: new Date().toISOString() })
          .eq('workspace_id', invitedWs.id)
          .eq('email', email)
          .eq('status', 'pending')
        await supabaseAdmin.from('users').update({ default_workspace_id: invitedWs.id }).eq('id', newUser.id)

        workspaceId = invitedWs.id
        workspaceName = invitedWs.name
        workspaceSlug = invitedWs.slug
        workspaceRole = inviteRole || 'member'
        messagingProfileId = invitedWs.messaging_profile_id || null
        billingGroupId = invitedWs.billing_group_id || null
        isInvited = true
      }
    }

    // Fallback: check workspace_invites table for this email
    if (!isInvited) {
      try {
        const { data: pendingInvite } = await supabaseAdmin
          .from('workspace_invites')
          .select('id, workspace_id, role')
          .eq('email', email)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (pendingInvite) {
          const { data: invitedWs } = await supabaseAdmin
            .from('workspaces')
            .select('id, name, slug, messaging_profile_id, billing_group_id')
            .eq('id', pendingInvite.workspace_id)
            .single()
          if (invitedWs) {
            await supabaseAdmin.from('workspace_members').insert({
              workspace_id: invitedWs.id,
              user_id: newUser.id,
              role: pendingInvite.role || 'member',
              is_active: true,
            })
            await supabaseAdmin
              .from('workspace_invites')
              .update({ status: 'accepted', updated_at: new Date().toISOString() })
              .eq('id', pendingInvite.id)
            await supabaseAdmin.from('users').update({ default_workspace_id: invitedWs.id }).eq('id', newUser.id)

            workspaceId = invitedWs.id
            workspaceName = invitedWs.name
            workspaceSlug = invitedWs.slug
            workspaceRole = pendingInvite.role || 'member'
            messagingProfileId = invitedWs.messaging_profile_id || null
            billingGroupId = invitedWs.billing_group_id || null
            isInvited = true
          }
        }
      } catch { /* workspace_invites table may not exist */ }
    }

    if (!isInvited) {
      // No invite — create their own workspace
      const wsName = `${googleName}'s Workspace`
      const slug = generateSlug(wsName)

      const { data: newWorkspace, error: wsError } = await supabaseAdmin
        .from('workspaces')
        .insert({ name: wsName, slug, is_active: true, created_by: newUser.id })
        .select()
        .single()

      if (wsError) {
        await supabaseAdmin.from('users').delete().eq('id', newUser.id)
        return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
      }

      await supabaseAdmin
        .from('workspace_members')
        .insert({ workspace_id: newWorkspace.id, user_id: newUser.id, role: 'owner', is_active: true })

      await supabaseAdmin.from('users').update({ default_workspace_id: newWorkspace.id }).eq('id', newUser.id)
      await supabaseAdmin.from('wallets').insert({
        user_id: newUser.id, workspace_id: newWorkspace.id, credits: 0, balance: 0, currency: 'USD',
      })

      workspaceId = newWorkspace.id
      workspaceName = newWorkspace.name
      workspaceSlug = newWorkspace.slug
      workspaceRole = 'owner'
      messagingProfileId = null
      billingGroupId = null
    }

    // Send welcome email (non-blocking)
    sendWelcomeEmail(newUser.email, newUser.name)

    const session = {
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      auth_provider: 'google',
      profile_photo_url: avatarUrl,
      workspaceId,
      workspaceName,
      workspaceSlug,
      workspaceRole,
      workspacePermissions: {},
      messagingProfileId,
      billingGroupId,
      isInvited,
      availableWorkspaces: [{ id: workspaceId, name: workspaceName, slug: workspaceSlug, role: workspaceRole }],
      loginTime: new Date().toISOString(),
    }

    const token = await signToken({
      userId: session.userId, email: session.email,
      workspaceId: session.workspaceId, workspaceRole: session.workspaceRole,
      messagingProfileId: session.messagingProfileId,
    })
    const res = NextResponse.json({ success: true, session, isNewUser: !isInvited })
    res.headers.set('Set-Cookie', buildSessionCookie(token))
    return res
  } catch (error) {
    console.error('Google auth error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
