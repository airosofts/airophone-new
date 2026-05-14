// Launches an RVM campaign — iterates contacts, calls VoiceDrop per recipient,
// deducts 2 credits per send, and inserts a `messages` row with type='voicemail'
// so the conversation chat window shows each voicemail.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getWorkspaceMessageRate } from '@/lib/pricing'
import { sendStaticVoicemail } from '@/lib/voicedrop'

// 2 credits per RVM send (matches AI-reply cost).
const CREDITS_PER_RVM = 2

export async function POST(request, { params }) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: campaignId } = await params

  const { data: campaign, error: cErr } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .single()

  if (cErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Atomic claim — only proceeds if currently 'draft' (prevents double-fire)
  const { data: claimed } = await supabaseAdmin
    .from('voicemail_campaigns')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return NextResponse.json({ error: 'Campaign is already running or completed' }, { status: 409 })
  }

  // Pull contacts from the selected lists, deduped by normalized phone
  const { data: rawContacts } = await supabaseAdmin
    .from('contacts')
    .select('id, phone_number')
    .eq('workspace_id', workspace.workspaceId)
    .in('contact_list_id', campaign.contact_list_ids)

  const seen = new Set()
  const contacts = []
  for (const c of (rawContacts || [])) {
    const p = normalizePhoneNumber(c.phone_number)
    if (!p || seen.has(p)) continue
    seen.add(p)
    contacts.push({ id: c.id, phone: p })
  }

  // Credit check up front so we fail clean before any sends
  const totalCreditsNeeded = contacts.length * CREDITS_PER_RVM
  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('id, credits')
    .eq('workspace_id', workspace.workspaceId)
    .single()

  const available = Number(wallet?.credits || 0)
  if (available < totalCreditsNeeded) {
    await supabaseAdmin
      .from('voicemail_campaigns')
      .update({ status: 'draft', started_at: null })
      .eq('id', campaignId)
    return NextResponse.json({
      error: 'Insufficient credits',
      required: totalCreditsNeeded,
      available,
    }, { status: 402 })
  }

  // Kick off async processing — don't block the HTTP response
  processVoicemailCampaign(campaign, contacts, user.userId, workspace.workspaceId, wallet)
    .catch(err => console.error('[voicemail-campaigns:start] async error:', err))

  return NextResponse.json({
    success: true,
    contactCount: contacts.length,
    estimatedCredits: totalCreditsNeeded,
  })
}

async function processVoicemailCampaign(campaign, contacts, userId, workspaceId, wallet) {
  let sentCount = 0
  let failedCount = 0
  const statusWebhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'}/api/webhooks/voicedrop`

  for (const contact of contacts) {
    try {
      // Get/create conversation so this voicemail shows in the chat window
      const conversation = await getOrCreateConversation(contact.phone, campaign.sender_number, workspaceId, userId)

      // Send via VoiceDrop
      const result = await sendStaticVoicemail({
        recordingUrl: campaign.recording_url,
        from: campaign.sender_number,
        to: contact.phone,
        statusWebhookUrl,
      })

      if (!result.ok) {
        failedCount++
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: campaign.sender_number,
          to_number: contact.phone,
          body: '[Voicemail]',
          type: 'voicemail',
          recording_url: campaign.recording_url,
          status: 'failed',
          error_message: result.data?.message || result.data?.error || 'VoiceDrop rejected the request',
          sent_by: userId,
        })
        continue
      }

      // Save outbound voicemail message
      const { data: msg } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: campaign.sender_number,
          to_number: contact.phone,
          body: '[Voicemail]',
          type: 'voicemail',
          recording_url: campaign.recording_url,
          status: 'sent',
          telnyx_message_id: result.data?.voice_drop_id || null, // reuse this column for VoiceDrop ID
          sent_by: userId,
        })
        .select('id')
        .single()

      // Deduct credits
      const newCredits = Math.max(0, Number(wallet.credits) - CREDITS_PER_RVM)
      await supabaseAdmin
        .from('wallets')
        .update({ credits: newCredits, updated_at: new Date().toISOString() })
        .eq('id', wallet.id)
      wallet.credits = newCredits

      await supabaseAdmin.from('transactions').insert({
        workspace_id: workspaceId,
        user_id: userId,
        type: 'voicemail_send',
        credits: -CREDITS_PER_RVM,
        amount: 0,
        currency: 'USD',
        description: `Voicemail to ${contact.phone} (${CREDITS_PER_RVM} credits)`,
        status: 'completed',
      })

      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id)

      sentCount++
    } catch (err) {
      console.error('[voicemail-campaigns:start] send error:', err.message)
      failedCount++
    }

    await supabaseAdmin
      .from('voicemail_campaigns')
      .update({ sent_count: sentCount, failed_count: failedCount })
      .eq('id', campaign.id)
  }

  await supabaseAdmin
    .from('voicemail_campaigns')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
    })
    .eq('id', campaign.id)
}

async function getOrCreateConversation(recipientNumber, senderNumber, workspaceId, userId) {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('phone_number', recipientNumber)
    .eq('from_number', senderNumber)
    .maybeSingle()

  if (existing) {
    if (!existing.workspace_id) {
      await supabaseAdmin.from('conversations').update({ workspace_id: workspaceId }).eq('id', existing.id)
    }
    return existing
  }

  const { data: created } = await supabaseAdmin
    .from('conversations')
    .insert({
      phone_number: recipientNumber,
      from_number: senderNumber,
      workspace_id: workspaceId,
      created_by: userId,
    })
    .select()
    .single()

  return created
}
