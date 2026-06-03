// Shared RVM (ringless voicemail) queue processor.
//
// Used by BOTH:
//   1. /api/voicemail-campaigns/process-queue — the every-minute cron sweeper
//      (resilience: survives tab close / API restart, honors pause).
//   2. /api/voicemail-campaigns/[id]/start — an immediate fire-and-forget kick
//      so a freshly-launched campaign starts sending NOW instead of waiting up
//      to 60s for the next cron tick (and so it works on localhost where no
//      cron is running).
//
// Both paths share the same per-row send logic, so behavior is identical.

import { supabaseAdmin } from '@/lib/supabase-server'
import { sendStaticVoicemail } from '@/lib/voicedrop'

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'}/api/webhooks/voicedrop`

// Process up to `batchSize` queued sends. If `campaignId` is given, only that
// campaign's rows are considered (used by the inline kick). Returns counts.
export async function sweepRvmQueue({ batchSize = 50, campaignId = null } = {}) {
  let q = supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id, campaign_id, workspace_id, contact_id, phone, source_column')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(batchSize)
  if (campaignId) q = q.eq('campaign_id', campaignId)

  const { data: rows, error } = await q
  if (error) {
    console.error('[rvm:sweep] query error:', error)
    return { picked: 0, sent: 0, failed: 0, skipped: 0, error: error.message }
  }
  if (!rows || rows.length === 0) {
    return { picked: 0, sent: 0, failed: 0, skipped: 0 }
  }

  const campaignIds = [...new Set(rows.map(r => r.campaign_id))]
  const { data: campaigns } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id, status, sender_number, recording_url, recording_path, voicedrop_recording_url')
    .in('id', campaignIds)
  const campaignById = new Map((campaigns || []).map(c => [c.id, c]))

  // Resolve the recording URL per running campaign once.
  const urlByCampaign = new Map()
  for (const c of (campaigns || [])) {
    if (c.status !== 'running') continue
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
      // Paused / completed between query and processing — leave row queued.
      skipped++
      continue
    }

    // Atomic claim — only send if still 'queued' (prevents double-dispatch when
    // the inline kick and the cron overlap).
    const { data: claimed } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .update({ status: 'sending' })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    if (!claimed) { skipped++; continue }

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
        .update({ status: 'sent', sent_at: new Date().toISOString(), message_id: msg?.id || null, conversation_id: conversation.id })
        .eq('id', row.id)
      await bumpCampaignCounter(row.campaign_id, 'sent_count')
      sent++
    } catch (err) {
      console.error('[rvm:sweep] send error', row.id, err.message)
      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({ status: 'failed', error: err.message || 'Unknown error' })
        .eq('id', row.id)
      await bumpCampaignCounter(row.campaign_id, 'failed_count')
      failed++
    }
  }

  // Mark any touched campaign 'completed' once its queue fully drains.
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
      console.log('[rvm:sweep] campaign completed', id)
    }
  }

  return { picked: rows.length, sent, failed, skipped }
}

// Drain ONE campaign's queue inline, in batches, until empty or paused.
// Fire-and-forget from /start so the campaign starts sending immediately
// (works on localhost with no cron, and avoids the ≤60s first-tick latency).
// Bounded by maxBatches so a runaway can't loop forever in one request.
export async function drainCampaignInline(campaignId, { batchSize = 25, maxBatches = 400 } = {}) {
  for (let i = 0; i < maxBatches; i++) {
    // Bail if the campaign is no longer running (paused/completed).
    const { data: c } = await supabaseAdmin
      .from('voicemail_campaigns')
      .select('status')
      .eq('id', campaignId)
      .maybeSingle()
    if (!c || c.status !== 'running') {
      console.log('[rvm:inline] stopping — campaign not running', { campaignId, status: c?.status })
      return
    }
    const res = await sweepRvmQueue({ batchSize, campaignId })
    if (res.picked === 0) {
      console.log('[rvm:inline] queue drained', { campaignId, batches: i })
      return
    }
    console.log('[rvm:inline] batch', { campaignId, ...res })
  }
  console.warn('[rvm:inline] hit maxBatches cap — cron will finish the rest', { campaignId })
}

async function bumpCampaignCounter(campaignId, column) {
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
    .insert({ workspace_id: workspaceId, from_number: fromNumber, phone_number: toNumber, source: 'voicemail_campaign' })
    .select('id')
    .single()
  return created
}
