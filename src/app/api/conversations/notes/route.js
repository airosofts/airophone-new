import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// Pretty-print a +1XXXXXXXXXX number as (XXX) XXX-XXXX; pass anything else through.
function formatPhone(num) {
  if (!num) return ''
  const d = String(num).replace(/\D/g, '')
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  if (ten.length !== 10) return num
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

// Branded HTML for a "you were mentioned in a note" email. Mirrors the
// onboarding OTP template (Plus Jakarta Sans / JetBrains Mono, #D63B1F accent).
function buildMentionEmail({ recipientName, actorName, conversationLabel, noteContent, link }) {
  const logoUrl = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const greeting = recipientName ? `Hi ${esc(recipientName.split(' ')[0])},` : 'Hi,'
  return `
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
        New mention
      </div>

      <h1 style="margin:0 0 10px;font-size:24px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.15;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        ${esc(actorName)} mentioned you
      </h1>
      <p style="margin:0 0 28px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        ${greeting} ${esc(actorName)} mentioned you in a note${conversationLabel ? ` on the conversation with <strong style="font-weight:500;color:#131210;">${esc(conversationLabel)}</strong>` : ''}.
      </p>

      <!-- Note content -->
      <div style="background:#EFEDE8;border:1px solid #E3E1DB;border-radius:12px;padding:18px 20px;margin-bottom:28px;">
        <p style="margin:0;font-size:14px;font-weight:400;color:#131210;line-height:1.6;white-space:pre-wrap;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">${esc(noteContent)}</p>
      </div>

      <!-- CTA -->
      <a href="${link}" style="display:inline-block;background:#D63B1F;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 22px;border-radius:10px;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        View in AiroPhone
      </a>

      <!-- Divider -->
      <div style="height:1px;background:#E3E1DB;margin:28px 0 20px;"></div>

      <p style="margin:0;font-size:13px;font-weight:300;color:#9B9890;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        You&rsquo;re receiving this because a teammate mentioned you in a note.
      </p>
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
</html>`
}

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { conversation_id, content, mentioned_users } = await request.json()

    if (!conversation_id || !content) {
      return NextResponse.json(
        { error: 'Conversation ID and content are required' },
        { status: 400 }
      )
    }

    const { data: note, error } = await supabaseAdmin
      .from('conversation_notes')
      .insert({
        conversation_id,
        content,
        created_by: user.userId,
        mentioned_users: mentioned_users || []
      })
      .select(`
        *,
        users!created_by(name)
      `)
      .single()

    if (error) {
      console.error('Error creating note:', error)
      return NextResponse.json(
        { error: 'Failed to create note' },
        { status: 500 }
      )
    }

    // Create notifications for mentioned users
    const recipientIds = (mentioned_users || []).filter(id => id !== user.userId) // Don't notify yourself
    if (recipientIds.length > 0) {
      const notifications = recipientIds.map(recipientId => ({
        workspace_id: user.workspaceId,
        recipient_id: recipientId,
        actor_id: user.userId,
        type: 'mention',
        conversation_id,
        note_id: note.id,
        content: content.length > 120 ? content.slice(0, 120) + '...' : content
      }))

      const { error: notifError } = await supabaseAdmin
        .from('notifications')
        .insert(notifications)

      if (notifError) {
        console.error('Error creating notifications:', notifError)
        // Don't fail the note creation if notifications fail
      }

      // Email each mentioned teammate. Best-effort: never block note creation.
      try {
        await sendMentionEmails({
          recipientIds,
          actorName: note.users?.name || user.name,
          conversationId,
          content
        })
      } catch (emailError) {
        console.error('Error sending mention emails:', emailError)
      }
    }

    // Format note with creator name
    const formattedNote = {
      ...note,
      created_by_name: note.users?.name || user.name
    }

    return NextResponse.json({
      success: true,
      note: formattedNote
    })

  } catch (error) {
    console.error('Error in create note API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Send a branded "you were mentioned" email to each recipient. Looks up emails
// and the conversation label, then fires one Resend send per recipient.
async function sendMentionEmails({ recipientIds, actorName, conversationId, content }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping mention emails')
    return
  }

  // Recipient emails/names
  const { data: recipients } = await supabaseAdmin
    .from('users')
    .select('id, name, email')
    .in('id', recipientIds)

  // Conversation context for the email + deep link
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('name, phone_number, from_number')
    .eq('id', conversationId)
    .single()

  const conversationLabel = conversation?.name || formatPhone(conversation?.phone_number)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'
  const link = conversation?.from_number
    ? `${appUrl}/inbox?from=${encodeURIComponent(conversation.from_number)}`
    : `${appUrl}/inbox`

  await Promise.all(
    (recipients || [])
      .filter(r => r.email)
      .map(r =>
        resend.emails.send({
          from: 'AiroPhone <noreply@airophone.com>',
          to: r.email,
          subject: `${actorName} mentioned you in a note`,
          html: buildMentionEmail({
            recipientName: r.name,
            actorName,
            conversationLabel,
            noteContent: content,
            link
          })
        }).catch(err => console.error(`Failed to email mention to ${r.email}:`, err))
      )
  )
}
