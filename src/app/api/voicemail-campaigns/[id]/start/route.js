// Launches an RVM campaign — iterates contacts, calls VoiceDrop per recipient,
// deducts 2 credits per send, and inserts a `messages` row with type='voicemail'
// so the conversation chat window shows each voicemail.

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getWorkspaceMessageRate } from '@/lib/pricing'
import { sendStaticVoicemail } from '@/lib/voicedrop'
import { buildRecipients } from '@/lib/phone-columns'
import { drainCampaignInline } from '@/lib/rvm-queue'

// 2 credits per RVM send (matches AI-reply cost).
const CREDITS_PER_RVM = 2

// A campaign can drain immediately (fast inline) only when it's NOT metered or
// scheduled — no throttle, no calling windows, no future start time. Anything
// metered/scheduled is paced by the cron.
function canDrainInline(campaign) {
  const hasThrottle = campaign.throttle_count && campaign.throttle_count > 0
  const hasWindows = Array.isArray(campaign.send_windows) && campaign.send_windows.length > 0
  const hasFutureStart = campaign.starts_at && new Date(campaign.starts_at).getTime() > Date.now()
  return !hasThrottle && !hasWindows && !hasFutureStart
}

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
    .select('id, phone_number, custom_fields')
    .eq('workspace_id', workspace.workspaceId)
    .in('contact_list_id', campaign.contact_list_ids)
    .order('created_at', { ascending: true })

  // Multi-column support: build the recipient list across every selected
  // phone column (primary + any custom_fields keys the wizard picked).
  // buildRecipients dedupes globally by E.164 so the same number can't be
  // dropped twice even if it appears in two columns or two contacts.
  const phoneColumns = Array.isArray(campaign.phone_columns) && campaign.phone_columns.length > 0
    ? campaign.phone_columns
    : ['phone_number']
  const allRecipients = buildRecipients(rawContacts || [], phoneColumns)

  // Chunk slice. chunk_size=0 means "send whole list" (legacy); chunk_index
  // is 1-based. Slicing here keeps the audit trail clean — this campaign row
  // represents exactly the recipients it dispatched.
  let recipients = allRecipients
  if (campaign.chunk_size && campaign.chunk_size > 0 && campaign.chunk_index && campaign.chunk_index > 0) {
    const start = (campaign.chunk_index - 1) * campaign.chunk_size
    recipients = allRecipients.slice(start, start + campaign.chunk_size)
  }

  // Shape downstream code expects: { id, phone, sourceColumn }
  const contacts = recipients.map(r => ({
    id: r.contactId,
    phone: r.phone,
    sourceColumn: r.sourceColumn,
  }))

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

  // Resolve the recording URL VoiceDrop will use to fetch the audio.
  // Priority: VoiceDrop's own S3 URL (permanent, no auth needed) → fresh Supabase
  // signed URL (7 days, no public bucket required) → stored URL (last resort).
  let recordingUrl = campaign.voicedrop_recording_url || campaign.recording_url
  let recordingUrlSource = campaign.voicedrop_recording_url ? 'voicedrop_s3' : 'stored_url'

  if (!campaign.voicedrop_recording_url && campaign.recording_path) {
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('voicemails')
      .createSignedUrl(campaign.recording_path, 604800)
    if (!signErr && signed?.signedUrl) {
      recordingUrl = signed.signedUrl
      recordingUrlSource = 'signed_url'
    }
  }

  // If the queue was already populated by the create endpoint (explicit
  // recipient list from the wizard), don't recompute from chunk slicing —
  // honor exactly what the user picked. Detected by checking the table.
  const { count: alreadyQueued } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)

  if (alreadyQueued && alreadyQueued > 0) {
    console.log('[voicemail-campaigns:start] queue already populated, skipping rebuild', {
      campaignId, alreadyQueued,
    })
    await supabaseAdmin.from('voicemail_campaigns')
      .update({ total_recipients: alreadyQueued, sent_count: 0, failed_count: 0 })
      .eq('id', campaignId)
    // Metered campaigns (throttle OR calling windows) are paced by the cron —
    // skip the fast inline drain (it would blow past the rate / spin outside a
    // window). Only "no throttle + anytime" campaigns drain immediately.
    if (canDrainInline(campaign)) {
      after(() => drainCampaignInline(campaignId).catch(err =>
        console.error('[voicemail-campaigns:start] inline drain error:', err.message)))
    }
    return NextResponse.json({
      success: true,
      contactCount: alreadyQueued,
      estimatedCredits: alreadyQueued * CREDITS_PER_RVM,
    })
  }

  console.log('[voicemail-campaigns:start] enqueueing', {
    campaignId,
    source: recordingUrlSource,
    senderNumber: campaign.sender_number,
    contactCount: contacts.length,
  })

  // Enqueue every recipient as a 'queued' row. Idempotent — the unique
  // (campaign_id, phone) constraint means re-running /start on the same
  // campaign is a no-op (existing rows are skipped via ON CONFLICT). This is
  // the line between "in-request loop dies on restart" and "work persists".
  if (contacts.length > 0) {
    const queueRows = contacts.map(c => ({
      campaign_id: campaignId,
      workspace_id: workspace.workspaceId,
      contact_id: c.id,
      phone: c.phone,
      source_column: c.sourceColumn || 'phone_number',
      status: 'queued',
    }))
    const { error: enqErr } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .upsert(queueRows, { onConflict: 'campaign_id,phone', ignoreDuplicates: true })
    if (enqErr) {
      console.error('[voicemail-campaigns:start] enqueue failed:', enqErr)
      await supabaseAdmin.from('voicemail_campaigns')
        .update({ status: 'draft', started_at: null })
        .eq('id', campaignId)
      return NextResponse.json({ error: 'Failed to enqueue sends' }, { status: 500 })
    }
  }

  // Cache totals on the campaign row so the UI can render progress in one
  // query. `total_recipients` is the actual queued count — if a phone was
  // already in the table from a previous launch the unique constraint kept it.
  const { count: actualTotal } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
  await supabaseAdmin.from('voicemail_campaigns')
    .update({ total_recipients: actualTotal || contacts.length, sent_count: 0, failed_count: 0 })
    .eq('id', campaignId)

  // Metered (throttle or windows) → cron-paced; otherwise drain now.
  if (canDrainInline(campaign)) {
    after(() => drainCampaignInline(campaignId).catch(err =>
      console.error('[voicemail-campaigns:start] inline drain error:', err.message)))
  }

  return NextResponse.json({
    success: true,
    contactCount: actualTotal || contacts.length,
    estimatedCredits: totalCreditsNeeded,
  })
}

async function processVoicemailCampaign(campaign, contacts, userId, workspaceId, wallet, recordingUrl) {
  let sentCount = 0
  let failedCount = 0
  const statusWebhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'}/api/webhooks/voicedrop`

  for (const contact of contacts) {
    try {
      // Get/create conversation so this voicemail shows in the chat window
      const conversation = await getOrCreateConversation(contact.phone, campaign.sender_number, workspaceId, userId)

      // Send via VoiceDrop using the signed URL (works regardless of bucket visibility)
      const result = await sendStaticVoicemail({
        recordingUrl,
        from: campaign.sender_number,
        to: contact.phone,
        statusWebhookUrl,
      })

      if (!result.ok) {
        failedCount++
        const errMsg = result.data?.message || result.data?.error || 'The voicemail request was rejected'
        console.error('[voicemail-campaigns:start] voicemail send failed for', contact.phone, errMsg, result.data)
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: campaign.sender_number,
          to_number: contact.phone,
          body: '[Voicemail]',
          type: 'voicemail',
          recording_url: campaign.recording_url,
          status: 'failed',
          error_message: errMsg,
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
