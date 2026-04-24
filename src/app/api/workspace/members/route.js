import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const logoUrl = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'

// GET — list all members + pending invites for this workspace
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select('id, role, is_active, created_at, users(id, name, email, profile_photo_url)')
      .eq('workspace_id', workspace.workspaceId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (error) throw error

    const members = (data || []).map(m => ({
      id: m.id,
      userId: m.users?.id,
      name: m.users?.name || m.users?.email,
      email: m.users?.email,
      avatar: m.users?.profile_photo_url || null,
      role: m.role,
      joinedAt: m.created_at,
    }))

    // Fetch pending invites (graceful fail if table doesn't exist yet)
    let pendingInvites = []
    try {
      const { data: invites } = await supabaseAdmin
        .from('workspace_invites')
        .select('id, email, role, created_at')
        .eq('workspace_id', workspace.workspaceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      pendingInvites = invites || []
    } catch {}

    return NextResponse.json({ success: true, members, pendingInvites })
  } catch (error) {
    console.error('[workspace/members GET]', error)
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
  }
}

// POST — invite a new member by email
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Only owners/admins can invite
    const { data: requester } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace.workspaceId)
      .eq('user_id', user.userId)
      .eq('is_active', true)
      .single()

    if (!requester || !['owner', 'admin'].includes(requester.role)) {
      return NextResponse.json({ error: 'Only workspace owners can invite members' }, { status: 403 })
    }

    const { email, role = 'member' } = await request.json()
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    const normalizedEmail = email.toLowerCase().trim()

    // Get workspace name + inviter name
    const { data: ws } = await supabaseAdmin
      .from('workspaces').select('name').eq('id', workspace.workspaceId).single()
    const { data: inviter } = await supabaseAdmin
      .from('users').select('name').eq('id', user.userId).single()

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users').select('id, name').eq('email', normalizedEmail).single()

    if (existingUser) {
      // Check if already a member
      const { data: existingMember } = await supabaseAdmin
        .from('workspace_members')
        .select('id, is_active')
        .eq('workspace_id', workspace.workspaceId)
        .eq('user_id', existingUser.id)
        .single()

      if (existingMember?.is_active) {
        return NextResponse.json({ error: 'This person is already a member of your workspace' }, { status: 409 })
      }

      if (existingMember && !existingMember.is_active) {
        // Re-activate
        await supabaseAdmin.from('workspace_members')
          .update({ is_active: true, role, updated_at: new Date().toISOString() })
          .eq('id', existingMember.id)
      } else {
        // Add as new member
        await supabaseAdmin.from('workspace_members').insert({
          workspace_id: workspace.workspaceId,
          user_id: existingUser.id,
          role,
          is_active: true,
        })
      }

      // Send notification email (existing user — link to login with workspace context)
      await sendInviteEmail(normalizedEmail, existingUser.name, inviter?.name, ws?.name, APP_URL, false, workspace.workspaceId)

      return NextResponse.json({ success: true, message: 'Member added and notified by email' })
    }

    // User doesn't exist — store pending invite and send signup invite
    // Check for existing pending invite
    const { data: existingInvite } = await supabaseAdmin
      .from('workspace_invites')
      .select('id')
      .eq('workspace_id', workspace.workspaceId)
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .single()

    if (existingInvite) {
      return NextResponse.json({ error: 'An invite has already been sent to this email' }, { status: 409 })
    }

    const { error: inviteError } = await supabaseAdmin.from('workspace_invites').insert({
      workspace_id: workspace.workspaceId,
      email: normalizedEmail,
      role,
      invited_by: user.userId,
      status: 'pending',
    })

    if (inviteError) {
      // Table may not exist yet — still send the email
      console.warn('[workspace/members] workspace_invites insert failed (table may not exist):', inviteError.message)
    }

    await sendInviteEmail(normalizedEmail, null, inviter?.name, ws?.name, APP_URL, true, workspace.workspaceId, role)

    return NextResponse.json({ success: true, message: 'Invite sent' })
  } catch (error) {
    console.error('[workspace/members POST]', error)
    return NextResponse.json({ error: 'Failed to invite member' }, { status: 500 })
  }
}

async function sendInviteEmail(toEmail, toName, inviterName, workspaceName, appUrl, isNewUser = false, workspaceId = null, role = 'member') {
  const greeting = toName ? toName.split(' ')[0] : 'there'
  const ctaUrl = isNewUser && workspaceId
    ? `${appUrl}/signup?invite=${encodeURIComponent(toEmail)}&wid=${workspaceId}&role=${role}`
    : isNewUser
    ? `${appUrl}/signup?invite=${encodeURIComponent(toEmail)}`
    : workspaceId
    ? `${appUrl}/login?wid=${workspaceId}`
    : `${appUrl}/login`
  const ctaText = isNewUser ? 'Create account &amp; join' : 'Accept invitation'
  const bodyText = isNewUser
    ? `<strong style="font-weight:500;color:#131210;">${inviterName || 'A teammate'}</strong> has invited you to join the <strong style="font-weight:500;color:#131210;">${workspaceName || 'AiroPhone'}</strong> workspace on AiroPhone. Create a free account to get started.`
    : `<strong style="font-weight:500;color:#131210;">${inviterName || 'A teammate'}</strong> has added you to the <strong style="font-weight:500;color:#131210;">${workspaceName || 'AiroPhone'}</strong> workspace. Sign in to get started.`

  await resend.emails.send({
    from: 'AiroPhone <noreply@airophone.com>',
    to: toEmail,
    subject: `${inviterName || 'Someone'} invited you to ${workspaceName || 'AiroPhone'}`,
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
      <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:500;color:#D63B1F;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">Team invite</div>
      <h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.2;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">You've been invited, ${greeting}</h1>
      <p style="margin:0 0 24px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        ${bodyText}
      </p>
      <a href="${ctaUrl}" style="display:block;background:#D63B1F;color:#FFFFFF;text-align:center;padding:13px 24px;border-radius:9px;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.01em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">${ctaText}</a>
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
  }).catch(err => console.warn('[workspace/members] Invite email failed:', err.message))
}
