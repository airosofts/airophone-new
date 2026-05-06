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
    subject: `Welcome to AiroPhone, ${firstName} 👋`,
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

    <!-- Header -->
    <div style="padding:24px 32px;border-bottom:1px solid #E3E1DB;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:10px;vertical-align:middle;">
            <img src="${logoUrl}" width="30" height="30" alt="AiroPhone" style="display:block;border-radius:7px;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:15px;font-weight:600;color:#131210;letter-spacing:-0.02em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">AiroPhone</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px 32px;">
      <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:500;color:#D63B1F;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">
        Welcome aboard
      </div>

      <h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.2;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Hey ${firstName}, you&rsquo;re all set!
      </h1>
      <p style="margin:0 0 24px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Welcome to AiroPhone. Your account is ready and your workspace has been created. We&rsquo;re excited to have you here.
      </p>

      <!-- Info box -->
      <div style="background:#F7F6F3;border:1px solid #E3E1DB;border-radius:10px;padding:18px 20px;margin-bottom:28px;">
        <p style="margin:0 0 10px;font-size:13px;font-weight:500;color:#131210;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">A quick heads up on your number</p>
        <p style="margin:0;font-size:13px;font-weight:300;color:#5C5A55;line-height:1.6;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
          Once you pick a phone number, it usually takes around 10 minutes for SMS to become fully active — carrier registration just takes a moment to process. Calls work immediately, and we&rsquo;ll let you know as soon as SMS is ready.
        </p>
      </div>

      <!-- CTA -->
      <a href="https://app.airophone.com/inbox" style="display:block;background:#D63B1F;color:#FFFFFF;text-align:center;padding:13px 24px;border-radius:9px;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.01em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Go to your inbox
      </a>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #E3E1DB;background:#F7F6F3;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;letter-spacing:0.04em;">
            &copy; 2025 AIROSOFTS LLC
          </td>
          <td style="text-align:right;">
            <a href="https://airophone.com" style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;text-decoration:none;letter-spacing:0.04em;">airophone.com</a>
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`,
  }).catch(err => console.warn('[signup] Welcome email failed (non-critical):', err.message))
}

function generateSlug(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { email, password, name, inviteWorkspaceId, inviteRole, referralCode } = body

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Email, password, and name are required' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if email already exists
    const { data: existingUser, error: lookupError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (lookupError) {
      console.error('[signup] Email lookup error:', lookupError)
      return NextResponse.json({ error: 'Failed to check account' }, { status: 500 })
    }

    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Create user (storing password as-is to match existing system)
    const { data: newUser, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        email: normalizedEmail,
        password_hash: password,
        name: name.trim(),
        role: 'user',
        is_active: true,
      })
      .select()
      .single()

    if (userError) {
      console.error('[signup] Error creating user:', userError)
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    let workspaceId, workspaceName, workspaceSlug, workspaceRole, messagingProfileId, billingGroupId
    let isInvited = false

    // If invite params are in the request, join that workspace directly (primary path)
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

        // Best-effort: mark any pending invite as accepted
        await supabaseAdmin
          .from('workspace_invites')
          .update({ status: 'accepted', updated_at: new Date().toISOString() })
          .eq('workspace_id', invitedWs.id)
          .eq('email', normalizedEmail)
          .eq('status', 'pending')

        await supabaseAdmin
          .from('users')
          .update({ default_workspace_id: invitedWs.id })
          .eq('id', newUser.id)

        workspaceId = invitedWs.id
        workspaceName = invitedWs.name
        workspaceSlug = invitedWs.slug
        workspaceRole = inviteRole || 'member'
        messagingProfileId = invitedWs.messaging_profile_id || null
        billingGroupId = invitedWs.billing_group_id || null
        isInvited = true
      }
    }

    // Fallback: check workspace_invites table (handles old invite links without wid param)
    if (!isInvited) {
      try {
        const { data: pendingInvite } = await supabaseAdmin
          .from('workspace_invites')
          .select('id, workspace_id, role')
          .eq('email', normalizedEmail)
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

            await supabaseAdmin
              .from('users')
              .update({ default_workspace_id: invitedWs.id })
              .eq('id', newUser.id)

            workspaceId = invitedWs.id
            workspaceName = invitedWs.name
            workspaceSlug = invitedWs.slug
            workspaceRole = pendingInvite.role || 'member'
            messagingProfileId = invitedWs.messaging_profile_id || null
            billingGroupId = invitedWs.billing_group_id || null
            isInvited = true
          }
        }
      } catch {
        // workspace_invites table may not exist — that's fine, wid param is the primary path
      }
    }

    if (!isInvited) {
      // No invite — create their own workspace as normal
      const workspaceNameNew = `${name.trim()}'s Workspace`
      const slug = generateSlug(workspaceNameNew)

      const { data: newWorkspace, error: wsError } = await supabaseAdmin
        .from('workspaces')
        .insert({
          name: workspaceNameNew,
          slug,
          is_active: true,
          created_by: newUser.id,
        })
        .select()
        .single()

      if (wsError) {
        console.error('Error creating workspace:', wsError)
        await supabaseAdmin.from('users').delete().eq('id', newUser.id)
        return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
      }

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

      await supabaseAdmin
        .from('users')
        .update({ default_workspace_id: newWorkspace.id })
        .eq('id', newUser.id)

      const { error: walletError } = await supabaseAdmin
        .from('wallets')
        .insert({ user_id: newUser.id, workspace_id: newWorkspace.id, credits: 0, balance: 0, currency: 'USD' })
      if (walletError) console.warn('[signup] Wallet create error (non-fatal):', walletError.message)

      // Referral setup — non-critical, never block signup if migration not yet run
      try {
        let refCode = generateReferralCode()
        let codeSet = false
        for (let attempt = 0; attempt < 5; attempt++) {
          const { error: codeErr } = await supabaseAdmin
            .from('workspaces')
            .update({ referral_code: refCode })
            .eq('id', newWorkspace.id)
          if (!codeErr) { codeSet = true; break }
          refCode = generateReferralCode()
        }

        if (referralCode) {
          const { data: referrerWs } = await supabaseAdmin
            .from('workspaces')
            .select('id')
            .eq('referral_code', referralCode.toUpperCase())
            .maybeSingle()
          if (referrerWs && referrerWs.id !== newWorkspace.id) {
            const { error: refInsertErr } = await supabaseAdmin.from('referrals').insert({
              referrer_workspace_id: referrerWs.id,
              referred_workspace_id: newWorkspace.id,
              referred_email: normalizedEmail,
              status: 'pending',
            })
            if (refInsertErr) console.warn('[signup] Referral insert error (non-fatal):', refInsertErr.message)
          }
        }
      } catch (refErr) {
        console.warn('[signup] Referral setup skipped:', refErr.message)
      }

      workspaceId = newWorkspace.id
      workspaceName = newWorkspace.name
      workspaceSlug = newWorkspace.slug
      workspaceRole = 'owner'
      messagingProfileId = newWorkspace.messaging_profile_id || null
      billingGroupId = newWorkspace.billing_group_id || null
    }

    // Send welcome email (non-blocking)
    sendWelcomeEmail(newUser.email, newUser.name)

    // Build session
    const session = {
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      workspaceId,
      workspaceName,
      workspaceSlug,
      workspaceRole,
      workspacePermissions: {},
      messagingProfileId,
      billingGroupId,
      isInvited,
      availableWorkspaces: [{
        id: workspaceId,
        name: workspaceName,
        slug: workspaceSlug,
        role: workspaceRole,
      }],
      loginTime: new Date().toISOString(),
    }

    let token
    try {
      token = await signToken({
        userId: session.userId,
        email: session.email,
        workspaceId: session.workspaceId,
        workspaceRole: session.workspaceRole,
        messagingProfileId: session.messagingProfileId,
      })
    } catch (tokenErr) {
      console.error('[signup] Token sign failed:', tokenErr)
      return NextResponse.json({ error: 'Failed to create session token' }, { status: 500 })
    }

    const response = NextResponse.json({ success: true, session })
    response.headers.set('Set-Cookie', buildSessionCookie(token))
    return response
  } catch (error) {
    console.error('[signup] Unhandled error:', error?.message || error)
    return NextResponse.json({ error: error?.message || 'An unexpected error occurred' }, { status: 500 })
  }
}
