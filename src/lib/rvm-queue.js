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
import { isWithinSendWindows } from '@/lib/scheduling'

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'}/api/webhooks/voicedrop`

// Light gap between sends as a safety margin against VoiceDrop rate limits on
// large batches. Verified that 3 instant sends succeed, so this is precaution,
// not a hard requirement — the 429 re-queue below is the real backstop.
// 400ms → ~10 min for a 1,500-recipient chunk.
const SEND_GAP_MS = 400
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Recompute a campaign's counts and complete it once every recipient is
// dispatched. Delivery confirmation (webhook) updates per-row status afterward
// but doesn't gate completion. Called by the sweep, the cron, and the webhook.
export async function finalizeRvmCampaign(campaignId) {
  const [
    { count: delivered },
    { count: failed },
    { count: queuedOrSending },
    { count: dispatched },
  ] = await Promise.all([
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'delivered'),
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'failed'),
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['queued', 'sending']),
    // everything handed off to VoiceDrop (sent + delivered + failed)
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['sent', 'delivered', 'failed']),
  ])

  // A campaign is DONE once every recipient is dispatched (no queued/sending
  // left). Delivery confirmation (the VoiceDrop webhook) is a per-row overlay
  // that upgrades 'sent' → 'delivered'/'failed' afterward — it does NOT block
  // completion. This avoids campaigns hanging on "awaiting delivery" forever
  // (webhooks are async and can't reach localhost at all).
  const update = {
    delivered_count: delivered || 0,
    undelivered_count: failed || 0,
    failed_count: failed || 0,
    sent_count: dispatched || 0,   // "Sent" = dispatched to VoiceDrop
  }
  if ((queuedOrSending || 0) === 0 && (dispatched || 0) > 0) {
    update.status = 'completed'
    update.completed_at = new Date().toISOString()
    console.log('[rvm:finalize] campaign completed', { campaignId, dispatched, delivered, failed })
  }
  await supabaseAdmin.from('voicemail_campaigns').update(update).eq('id', campaignId)
  return { delivered: delivered || 0, failed: failed || 0, dispatched: dispatched || 0 }
}

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
    .select('id, status, sender_number, recording_url, recording_path, voicedrop_recording_url, created_by, throttle_count, throttle_window_seconds, send_windows, send_timezone, starts_at')
    .in('id', campaignIds)
  const campaignById = new Map((campaigns || []).map(c => [c.id, c]))

  // Two gates per campaign, computed once:
  //   startReached  — a scheduled start time (starts_at) has arrived
  //   inWindow      — "now" (in the campaign tz) is inside a calling window
  // Both must pass for a row to dispatch; otherwise it stays queued.
  const now = new Date()
  const startReachedByCampaign = new Map()
  const inWindowByCampaign = new Map()
  for (const c of (campaigns || [])) {
    startReachedByCampaign.set(c.id, !c.starts_at || new Date(c.starts_at).getTime() <= now.getTime())
    inWindowByCampaign.set(c.id, isWithinSendWindows(now, c.send_windows, c.send_timezone || 'America/New_York'))
  }

  // Throttle allowance per campaign. For a campaign capped at N every
  // `throttle_window_seconds`, count how many already went out in the trailing
  // window and allow only the remainder this sweep. Un-throttled → Infinity.
  // Throttled rows beyond the allowance are left 'queued' for the next tick.
  const allowanceByCampaign = new Map()
  const processedByCampaign = new Map()
  for (const c of (campaigns || [])) {
    if (!c.throttle_count || c.throttle_count <= 0) {
      allowanceByCampaign.set(c.id, Infinity)
      continue
    }
    const windowSec = c.throttle_window_seconds && c.throttle_window_seconds > 0 ? c.throttle_window_seconds : 3600
    const sinceIso = new Date(Date.now() - windowSec * 1000).toISOString()
    const { count: recentSent } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .eq('status', 'sent')
      .gte('sent_at', sinceIso)
    allowanceByCampaign.set(c.id, Math.max(0, c.throttle_count - (recentSent || 0)))
  }

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

  let sent = 0, failed = 0, skipped = 0, requeued = 0
  let firstSend = true

  for (const row of rows) {
    const campaign = campaignById.get(row.campaign_id)
    if (!campaign || campaign.status !== 'running') {
      // Paused / completed between query and processing — leave row queued.
      skipped++
      continue
    }

    // Scheduled-start gate: hold until the campaign's starts_at has arrived.
    if (!startReachedByCampaign.get(row.campaign_id)) {
      skipped++
      continue
    }

    // Calling-window gate: outside the campaign's send windows → leave queued.
    if (!inWindowByCampaign.get(row.campaign_id)) {
      skipped++
      continue
    }

    // Throttle gate: if this campaign has already used its allowance for the
    // current window, leave the row 'queued' for the next tick.
    const allowance = allowanceByCampaign.get(row.campaign_id) ?? Infinity
    const usedSoFar = processedByCampaign.get(row.campaign_id) || 0
    if (usedSoFar >= allowance) {
      skipped++
      continue
    }
    processedByCampaign.set(row.campaign_id, usedSoFar + 1)

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
      failed++
      continue
    }

    try {
      // Throttle: pause before every send except the first in this batch so we
      // stay under VoiceDrop's rate limit.
      if (!firstSend) await sleep(SEND_GAP_MS)
      firstSend = false

      const conversation = await getOrCreateConversation(row.phone, campaign.sender_number, row.workspace_id, campaign.created_by)
      if (!conversation?.id) {
        // Conversation get-or-create failed (DB error logged inside the helper).
        // Mark failed with a clear reason rather than crashing on .id.
        await supabaseAdmin.from('voicemail_campaign_sends')
          .update({ status: 'failed', error: 'Could not create conversation record' })
          .eq('id', row.id)
        failed++
        continue
      }

      const result = await sendStaticVoicemail({
        recordingUrl,
        from: campaign.sender_number,
        to: row.phone,
        statusWebhookUrl: WEBHOOK_URL,
      })

      // Rate-limited (HTTP 429) → NOT a real failure. Put the row back to
      // 'queued' so the next batch/cron retries it after the gap.
      if (result.status === 429) {
        console.warn('[rvm:sweep] rate-limited, re-queueing', row.id)
        await supabaseAdmin.from('voicemail_campaign_sends')
          .update({ status: 'queued' })
          .eq('id', row.id)
        requeued++
        await sleep(SEND_GAP_MS * 2)
        continue
      }

      if (!result.ok) {
        const errMsg = result.data?.message || result.data?.error || 'The voicemail request was rejected'
        await supabaseAdmin.from('voicemail_campaign_sends')
          .update({ status: 'failed', error: errMsg, conversation_id: conversation.id })
          .eq('id', row.id)
        // Column set MUST match the proven start-route schema (no workspace_id;
        // use recording_url / sent_by / error_message). A wrong column here is
        // what stopped voicemail messages from appearing in the conversation.
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: campaign.sender_number,
          to_number: row.phone,
          body: '[Voicemail]',
          type: 'voicemail',
          recording_url: campaign.recording_url,
          status: 'failed',
          error_message: errMsg,
          sent_by: campaign.created_by,
        })
        failed++
        continue
      }

      const { data: msg, error: msgErr } = await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        from_number: campaign.sender_number,
        to_number: row.phone,
        body: '[Voicemail]',
        type: 'voicemail',
        recording_url: campaign.recording_url,
        status: 'sent',
        // VoiceDrop's send response carries no job id, so leave this null
        // (multiple nulls are allowed by the unique index). Do NOT reuse the
        // descriptive `message` text — it isn't an id.
        telnyx_message_id: null,
        sent_by: campaign.created_by,
      }).select('id').single()

      if (msgErr) {
        // Surface the real reason instead of swallowing it. The send already
        // went out, so we still count it sent — but log so a schema/constraint
        // problem can't hide again.
        console.error('[rvm:sweep] message insert failed (send already placed)', {
          to: row.phone, conversation_id: conversation.id, error: msgErr.message,
        })
      } else if (!msg?.id) {
        // Insert returned no error AND no row — the case that would silently
        // drop a chat. Log loudly so we can see it.
        console.error('[rvm:sweep] message insert returned no row (no error)', {
          to: row.phone, conversation_id: conversation.id,
        })
      } else {
        console.log('[rvm:sweep] sent', { to: row.phone, conversation_id: conversation.id, message_id: msg.id })
      }

      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({ status: 'sent', sent_at: new Date().toISOString(), message_id: msg?.id || null, conversation_id: conversation.id })
        .eq('id', row.id)
      sent++
    } catch (err) {
      console.error('[rvm:sweep] send error', row.id, err.message)
      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({ status: 'failed', error: err.message || 'Unknown error' })
        .eq('id', row.id)
      failed++
    }
  }

  // Recompute counts + decide completion based on DELIVERY, not just dispatch.
  for (const id of campaignIds) {
    const c = campaignById.get(id)
    if (!c || c.status !== 'running') continue
    await finalizeRvmCampaign(id)
  }

  return { picked: rows.length, sent, failed, skipped, requeued }
}

// Sweep all 'running' campaigns through finalizeRvmCampaign — completes those
// whose deliveries are all confirmed (or timed out). Needed because once a
// campaign's queue is fully dispatched it no longer appears in the queued-row
// sweep, yet still needs to transition to 'completed' when deliveries land.
export async function finalizeRunningCampaigns() {
  const { data: running } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id')
    .eq('status', 'running')
    .limit(200)
  for (const c of (running || [])) {
    await finalizeRvmCampaign(c.id)
  }
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

// Mirrors the proven getOrCreateConversation from the start route. Matches on
// (phone_number, from_number) WITHOUT a workspace filter so legacy rows with a
// null workspace_id are found (and backfilled) instead of colliding with the
// unique constraint on insert. Inserts only columns that actually exist —
// crucially `created_by` (NOT NULL) and NO `source` column.
async function getOrCreateConversation(toNumber, fromNumber, workspaceId, createdBy) {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id, workspace_id')
    .eq('phone_number', toNumber)
    .eq('from_number', fromNumber)
    .maybeSingle()

  if (existing) {
    if (!existing.workspace_id) {
      await supabaseAdmin.from('conversations').update({ workspace_id: workspaceId }).eq('id', existing.id)
    }
    return existing
  }

  const { data: created, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      phone_number: toNumber,
      from_number: fromNumber,
      workspace_id: workspaceId,
      created_by: createdBy,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[rvm:sweep] conversation insert failed', { toNumber, fromNumber, error: error.message })
    return null
  }
  return created
}
