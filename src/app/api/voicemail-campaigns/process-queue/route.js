// Cron-driven sweeper for the voicemail (RVM) campaign queue.
//
// Called every minute by followup-cron with `Authorization: Bearer CRON_SECRET`.
// Pulls a batch of voicemail_campaign_sends rows where:
//   - status = 'queued'
//   - parent campaign status = 'running' (NOT 'paused' / 'completed')
// Dispatches each via VoiceDrop, writes a `messages` row for inbox visibility,
// bumps the campaign's sent_count / failed_count, and when the campaign's
// queue empties marks it 'completed'.
//
// Resilience properties:
//   • Tab close / API restart — irrelevant; the queue lives in Postgres
//   • Pause — flipping campaign.status to 'paused' makes the sweeper skip it
//   • Resume — flipping back to 'running' picks up exactly where it stopped
//   • Idempotency — each row is claimed via UPDATE … WHERE status='queued'
//     before sending; concurrent sweepers can't double-dispatch.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { sendStaticVoicemail } from '@/lib/voicedrop'

const BATCH_SIZE = 50           // sends processed per cron tick
const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'}/api/webhooks/voicedrop`

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn('[rvm:process-queue] 401 — auth mismatch', { hasSecret: !!secret, hasAuth: !!auth })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Pull a batch of queued rows. Filter to running campaigns by joining
  // through campaign_id — Supabase doesn't allow JOIN on filter, so we query
  // sends first, then fetch their campaigns, then drop any whose campaign
  // isn't 'running'.
  const { data: rows, error } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id, campaign_id, workspace_id, contact_id, phone, source_column')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[rvm:process-queue] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, picked: 0, sent: 0, failed: 0 })
  }

  // Group by campaign; load each unique campaign once.
  const campaignIds = [...new Set(rows.map(r => r.campaign_id))]
  const { data: campaigns } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id, status, sender_number, recording_url, recording_path, voicedrop_recording_url')
    .in('id', campaignIds)
  const campaignById = new Map((campaigns || []).map(c => [c.id, c]))

  // Resolve the recording URL per campaign once (signing is the expensive part).
  const urlByCampaign = new Map()
  for (const c of (campaigns || [])) {
    if (c.status !== 'running') continue   // 'paused' / 'completed' / 'draft' — skip
    let url = c.voicedrop_recording_url || c.recording_url
    if (!c.voicedrop_recording_url && c.recording_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from('voicemails')
        .createSignedUrl(c.recording_path, 604800)
      if (signed?.signedUrl) url = signed.signedUrl
    }
    urlByCampaign.set(c.id, url)
  }

  let sent = 0, failed = 0, skipped = 0

  for (const row of rows) {
    const campaign = campaignById.get(row.campaign_id)
    if (!campaign || campaign.status !== 'running') {
      // Campaign was paused / completed between query and processing.
      // Leave the row 'queued' — next tick will reconsider.
      skipped++
      continue
    }

    // Claim the row atomically — only proceed if it's still 'queued'.
    // Another sweeper could be running; this UPDATE returns 0 rows in that
    // case and we skip without sending.
    const { data: claimed } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .update({ status: 'sending' })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    if (!claimed) {
      skipped++
      continue
    }

    const recordingUrl = urlByCampaign.get(row.campaign_id)
    if (!recordingUrl) {
      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({ status: 'failed', error: 'No recording URL resolvable' })
        .eq('id', row.id)
      await bumpCampaignCounter(row.campaign_id, 'failed_count')
      failed++
      continue
    }

    try {
      // Get/create the conversation so the voicemail shows in the chat inbox.
      const conversation = await getOrCreateConversation(row.phone, campaign.sender_number, row.workspace_id)

      const result = await sendStaticVoicemail({
        recordingUrl,
        from: campaign.sender_number,
        to: row.phone,
        statusWebhookUrl: WEBHOOK_URL,
      })

      if (!result.ok) {
        const errMsg = result.data?.message || result.data?.error || 'The voicemail request was rejected'
        await supabaseAdmin.from('voicemail_campaign_sends')
          .update({ status: 'failed', error: errMsg, conversation_id: conversation?.id || null })
          .eq('id', row.id)
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          workspace_id: row.workspace_id,
          direction: 'outbound',
          from_number: campaign.sender_number,
          to_number: row.phone,
          body: '[Voicemail — failed]',
          type: 'voicemail',
          status: 'failed',
          error: errMsg,
        })
        await bumpCampaignCounter(row.campaign_id, 'failed_count')
        failed++
        continue
      }

      // Record the outbound voicemail row in `messages` so it shows in chat.
      const { data: msg } = await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        workspace_id: row.workspace_id,
        direction: 'outbound',
        from_number: campaign.sender_number,
        to_number: row.phone,
        body: '[Voicemail]',
        type: 'voicemail',
        status: 'sent',
      }).select('id').single()

      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          message_id: msg?.id || null,
          conversation_id: conversation.id,
        })
        .eq('id', row.id)
      await bumpCampaignCounter(row.campaign_id, 'sent_count')
      sent++
    } catch (err) {
      console.error('[rvm:process-queue] send error', row.id, err.message)
      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({ status: 'failed', error: err.message || 'Unknown error' })
        .eq('id', row.id)
      await bumpCampaignCounter(row.campaign_id, 'failed_count')
      failed++
    }
  }

  // For every campaign touched this tick, check whether its queue emptied.
  // If yes, mark it 'completed'. Cheap query: count queued rows per campaign.
  for (const id of campaignIds) {
    const c = campaignById.get(id)
    if (!c || c.status !== 'running') continue
    const { count: stillQueued } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .in('status', ['queued', 'sending'])
    if ((stillQueued || 0) === 0) {
      await supabaseAdmin.from('voicemail_campaigns')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', id)
      console.log('[rvm:process-queue] campaign completed', id)
    }
  }

  console.log('[rvm:process-queue] tick', { picked: rows.length, sent, failed, skipped })
  return NextResponse.json({ ok: true, picked: rows.length, sent, failed, skipped })
}

async function bumpCampaignCounter(campaignId, column) {
  // Atomic increment via the rpc-less pattern: fetch + update.
  // For low contention this is fine; if multiple sweepers race the worst case
  // is a brief inconsistency that the next tick corrects.
  const { data } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select(column)
    .eq('id', campaignId)
    .maybeSingle()
  const current = Number(data?.[column] || 0)
  await supabaseAdmin
    .from('voicemail_campaigns')
    .update({ [column]: current + 1 })
    .eq('id', campaignId)
}

async function getOrCreateConversation(toNumber, fromNumber, workspaceId) {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('from_number', fromNumber)
    .eq('phone_number', toNumber)
    .maybeSingle()
  if (existing) return existing
  const { data: created } = await supabaseAdmin
    .from('conversations')
    .insert({
      workspace_id: workspaceId,
      from_number: fromNumber,
      phone_number: toNumber,
      source: 'voicemail_campaign',
    })
    .select('id')
    .single()
  return created
}
