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
import { isWithinSendWindows, startOfLocalDayUTC, localDayKey } from '@/lib/scheduling'

const WEBHOOK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'}/api/webhooks/voicedrop`

// Light gap between sends as a safety margin against VoiceDrop rate limits on
// large batches. Verified that 3 instant sends succeed, so this is precaution,
// not a hard requirement — the 429 re-queue below is the real backstop.
// 400ms → ~10 min for a 1,500-recipient chunk.
const SEND_GAP_MS = 400
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Concurrency / pacing ────────────────────────────────────────────────────
// VoiceDrop delivers each ringless voicemail as a REAL outbound call on the
// workspace's Telnyx trunk, which has a hard concurrent-call cap. The per-hour
// throttle only bounds the hourly TOTAL — it happily lets the whole hour's budget
// burst in the first minute, so many calls go in-flight at once and Telnyx rejects
// the overflow with "Concurrent Call Limit Reached". Those rejected drops silently
// fail (and used to take monitor numbers down with them).
//
// Fix: pace INITIATIONS per rolling minute so in-flight calls stay under the
// trunk cap. Two gates, both counted over a trailing 60s window:
//   • per-workspace — the trunk is shared by all the workspace's campaigns, so
//     the concurrency ceiling is per-workspace. Telnyx raised our voicedrop-trunk
//     cap from 10 → 100 concurrent (2026-07-01), so the default is 80/min: with a
//     ~60s drop, concurrency ≈ sends/min, leaving ~20 channels of headroom under
//     100. Tune via RVM_MAX_SENDS_PER_MINUTE (raise it only if Telnyx raises the
//     trunk cap again).
//   • per-campaign  — spread the user's hourly throttle EVENLY (100/hr → ~2/min)
//     instead of bursting it, so a single campaign never floods the trunk.
const PACE_WINDOW_MS = 60_000
const MAX_SENDS_PER_MINUTE = Number(process.env.RVM_MAX_SENDS_PER_MINUTE) || 80

// A network-level failure (couldn't reach the voicemail provider at all) is
// transient — re-queue and retry on a later tick instead of permanently failing
// the recipient. After this many attempts we give up and mark it failed so a
// real, sustained outage doesn't loop forever.
const MAX_SEND_ATTEMPTS = 5

// 2 credits per voicemail. Deducted per send via the atomic deduct_message_cost
// RPC; when a campaign's wallet can't afford the next send it auto-pauses
// (resumable after top-up) instead of failing.
const CREDITS_PER_RVM = 2
const NETWORK_CAUSE_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']
function isNetworkError(err) {
  const cause = err?.cause?.code || err?.code || ''
  return /fetch failed|network|socket|timeout/i.test(err?.message || '') || NETWORK_CAUSE_CODES.includes(cause)
}

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
  // Only pull rows from RUNNING campaigns. Otherwise a PAUSED campaign's old
  // queued rows (e.g. a 15k list) are the oldest, fill the whole batch, get
  // skipped, and STARVE every running campaign — the cron does 0 work forever.
  let runningIds
  if (campaignId) {
    runningIds = [campaignId]
  } else {
    const { data: rc } = await supabaseAdmin
      .from('voicemail_campaigns').select('id').eq('status', 'running').limit(1000)
    runningIds = (rc || []).map(c => c.id)
    if (runningIds.length === 0) return { picked: 0, sent: 0, failed: 0, skipped: 0 }
  }

  const q = supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id, campaign_id, workspace_id, contact_id, phone, source_column, attempts')
    .eq('status', 'queued')
    .in('campaign_id', runningIds)
    .order('created_at', { ascending: true })
    .limit(batchSize)

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
    .select('id, status, sender_number, recording_url, recording_path, voicedrop_recording_url, created_by, workspace_id, throttle_count, throttle_window_seconds, send_windows, send_timezone, starts_at, daily_cap, send_days')
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
    inWindowByCampaign.set(c.id, isWithinSendWindows(now, c.send_windows, c.send_timezone || 'America/New_York', c.send_days))
  }

  // Throttle allowance per campaign. For a campaign capped at N every
  // `throttle_window_seconds`, count how many already went out in the trailing
  // window and allow only the remainder this sweep. Un-throttled → Infinity.
  // Throttled rows beyond the allowance are left 'queued' for the next tick.
  // Count anything already DISPATCHED (sent/delivered/failed) — a delivery
  // webhook flips 'sent' → 'delivered', so counting only 'sent' would undercount
  // and let bursts slip past the throttle.
  const DISPATCHED = ['sent', 'delivered', 'failed']
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
      .in('status', DISPATCHED)
      .gte('sent_at', sinceIso)
    allowanceByCampaign.set(c.id, Math.max(0, c.throttle_count - (recentSent || 0)))
  }

  // Daily-cap allowance per campaign. Count how many already went out TODAY
  // (in the campaign's local timezone) and allow only the remainder this sweep.
  // No cap → Infinity. The effective per-row allowance is min(throttle, daily).
  const dailyAllowanceByCampaign = new Map()
  for (const c of (campaigns || [])) {
    if (!c.daily_cap || c.daily_cap <= 0) {
      dailyAllowanceByCampaign.set(c.id, Infinity)
      continue
    }
    const dayStartIso = new Date(startOfLocalDayUTC(Date.now(), c.send_timezone || 'America/New_York')).toISOString()
    const { count: sentToday } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', DISPATCHED)
      .gte('sent_at', dayStartIso)
    dailyAllowanceByCampaign.set(c.id, Math.max(0, c.daily_cap - (sentToday || 0)))
  }

  // Pacing allowances over the trailing 60s — the real defense against blowing
  // past the trunk's concurrent-call cap (see PACE_WINDOW notes up top).
  const paceSinceIso = new Date(Date.now() - PACE_WINDOW_MS).toISOString()

  // Per-campaign: spread the hourly throttle evenly instead of bursting it.
  const campaignPaceByCampaign = new Map()
  for (const c of (campaigns || [])) {
    if (!c.throttle_count || c.throttle_count <= 0) { campaignPaceByCampaign.set(c.id, Infinity); continue }
    const windowSec = c.throttle_window_seconds && c.throttle_window_seconds > 0 ? c.throttle_window_seconds : 3600
    const evenPerMinute = Math.max(1, Math.ceil(c.throttle_count * 60 / windowSec))
    const { count: sent60 } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', DISPATCHED)
      .gte('sent_at', paceSinceIso)
    campaignPaceByCampaign.set(c.id, Math.max(0, evenPerMinute - (sent60 || 0)))
  }

  // Per-workspace: the Telnyx trunk is shared across the workspace's campaigns,
  // so the hard concurrency ceiling is per-workspace. Remaining = cap − sent in
  // the last minute by ANY of the workspace's campaigns.
  const workspaceIds = [...new Set((campaigns || []).map(c => c.workspace_id).filter(Boolean))]
  const wsPaceRemaining = new Map()
  for (const wsId of workspaceIds) {
    const { count: wsSent60 } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId)
      .in('status', DISPATCHED)
      .gte('sent_at', paceSinceIso)
    wsPaceRemaining.set(wsId, Math.max(0, MAX_SENDS_PER_MINUTE - (wsSent60 || 0)))
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
  let pacedOut = 0   // rows held back purely by the per-minute pace gate
  let firstSend = true
  const processedByWorkspace = new Map()

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

    // Throttle + daily-cap gate: the row may dispatch only if it's under the
    // trailing-window throttle allowance, today's remaining daily cap, AND the
    // evenly-spread per-minute pace (so the hourly budget can't burst). Anything
    // beyond is left 'queued' for a later tick / the next day.
    const allowance = Math.min(
      allowanceByCampaign.get(row.campaign_id) ?? Infinity,
      dailyAllowanceByCampaign.get(row.campaign_id) ?? Infinity,
      campaignPaceByCampaign.get(row.campaign_id) ?? Infinity,
    )
    const usedSoFar = processedByCampaign.get(row.campaign_id) || 0
    if (usedSoFar >= allowance) {
      // If the ONLY thing holding it back is the per-minute pace, flag it so the
      // inline drainer knows to stop and let the cron pace the rest.
      if (usedSoFar >= (campaignPaceByCampaign.get(row.campaign_id) ?? Infinity)) pacedOut++
      skipped++
      continue
    }

    // Per-workspace concurrency ceiling: never put more calls in-flight on the
    // shared Telnyx trunk than it can hold. Counted across ALL the workspace's
    // campaigns this minute.
    const wsId = row.workspace_id
    const wsRemaining = wsPaceRemaining.get(wsId) ?? Infinity
    const wsUsed = processedByWorkspace.get(wsId) || 0
    if (wsUsed >= wsRemaining) { pacedOut++; skipped++; continue }

    processedByCampaign.set(row.campaign_id, usedSoFar + 1)
    processedByWorkspace.set(wsId, wsUsed + 1)

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
        // Capture VoiceDrop's job id (if the send response returns one) so the
        // delivery webhook can correlate this exact send → accurate Delivered/
        // Not-delivered. Falls back to null when VoiceDrop returns no id.
        telnyx_message_id: result?.data?.voice_drop_id || result?.data?.data?.voice_drop_id || result?.data?.message?.voice_drop_id || result?.data?.id || null,
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

      // Charge 2 credits for the successful send (atomic). Billing is pay-as-you-
      // send: credits come out per voicemail AS it's sent — never upfront. When the
      // wallet can no longer afford the NEXT send, auto-pause the campaign with
      // paused_reason='insufficient_credits' so it stops here (resumable after a
      // top-up). This matches the "Paused — out of credits" banner and the wizard's
      // billing copy: you only pay for voicemails actually sent.
      try {
        const { data: nb } = await supabaseAdmin.rpc('deduct_wallet_credits', { p_workspace_id: row.workspace_id, p_amount: CREDITS_PER_RVM })
        const balance = typeof nb === 'number' ? nb : null
        if (balance !== null && balance < CREDITS_PER_RVM) {
          await supabaseAdmin.from('voicemail_campaigns')
            .update({ status: 'paused', paused_reason: 'insufficient_credits' })
            .eq('id', row.campaign_id)
            .eq('status', 'running')
          console.warn('[rvm:sweep] out of credits — campaign auto-paused', { campaignId: row.campaign_id, balance })
        }
      } catch (e) {
        console.error('[rvm:sweep] credit deduction failed (send already placed)', { to: row.phone, error: e.message })
      }
    } catch (err) {
      const attempts = (row.attempts || 0) + 1
      const cause = err?.cause?.code || err?.code || ''
      // Couldn't even reach the provider → transient. Re-queue (bumping the
      // attempt count) so a momentary blip doesn't permanently burn a recipient.
      if (isNetworkError(err) && attempts < MAX_SEND_ATTEMPTS) {
        console.warn('[rvm:sweep] network error — re-queueing for retry', { id: row.id, cause: cause || err?.message, attempts })
        await supabaseAdmin.from('voicemail_campaign_sends')
          .update({ status: 'queued', attempts })
          .eq('id', row.id)
        requeued++
        await sleep(SEND_GAP_MS * 2)
        continue
      }
      const reason = isNetworkError(err)
        ? `Could not reach the voicemail service after ${attempts} attempts (${cause || 'network error'})`
        : (err.message || 'Unknown error')
      console.error('[rvm:sweep] send error', row.id, reason)
      await supabaseAdmin.from('voicemail_campaign_sends')
        .update({ status: 'failed', error: reason, attempts })
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

  return { picked: rows.length, sent, failed, skipped, requeued, pacedOut }
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

// Resolve the recording URL VoiceDrop fetches for a campaign (S3 → signed → stored).
async function resolveRecordingUrl(c) {
  let url = c.voicedrop_recording_url || c.recording_url
  if (!c.voicedrop_recording_url && c.recording_path) {
    const { data: signed } = await supabaseAdmin.storage
      .from('voicemails').createSignedUrl(c.recording_path, 604800)
    if (signed?.signedUrl) url = signed.signedUrl
  }
  return url
}

// Monitor / canary heartbeat: for every running campaign with monitor_numbers,
// send the voicemail to those numbers ONCE PER LOCAL DAY (respecting start time,
// calling windows + days) — so you can confirm each day's drip actually fired.
// Called by the cron every tick; the once-per-day guard makes repeated calls safe.
export async function sendMonitorHeartbeats() {
  const { data: campaigns } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id, status, sender_number, recording_url, recording_path, voicedrop_recording_url, created_by, workspace_id, monitor_numbers, monitor_last_sent_at, send_windows, send_timezone, send_days, starts_at')
    .eq('status', 'running')
    .not('monitor_numbers', 'is', null)
    .limit(200)

  const now = new Date()
  for (const c of (campaigns || [])) {
    const nums = Array.isArray(c.monitor_numbers) ? c.monitor_numbers.filter(Boolean) : []
    if (nums.length === 0) continue

    const tz = c.send_timezone || 'America/New_York'
    // Same gates as real sends: scheduled start reached + inside window/day.
    if (c.starts_at && new Date(c.starts_at).getTime() > now.getTime()) continue
    if (!isWithinSendWindows(now, c.send_windows, tz, c.send_days)) continue
    // Once per local day.
    if (c.monitor_last_sent_at && localDayKey(new Date(c.monitor_last_sent_at).getTime(), tz) === localDayKey(now.getTime(), tz)) continue

    // ATOMICALLY claim today's heartbeat BEFORE sending: stamp monitor_last_sent_at
    // only if it hasn't fired since local midnight. If 0 rows update, another tick
    // already claimed today → skip. This guarantees ONCE PER DAY even if the sends
    // below fail/crash (otherwise it re-fires every single minute).
    const todayStartIso = new Date(startOfLocalDayUTC(now.getTime(), tz)).toISOString()
    const { data: claimed } = await supabaseAdmin
      .from('voicemail_campaigns')
      .update({ monitor_last_sent_at: now.toISOString() })
      .eq('id', c.id)
      .or(`monitor_last_sent_at.is.null,monitor_last_sent_at.lt.${todayStartIso}`)
      .select('id')
    if (!claimed || claimed.length === 0) continue   // already fired today

    const recordingUrl = await resolveRecordingUrl(c)
    if (!recordingUrl) continue

    let anySent = false
    for (const phone of nums) {
      try {
        const conversation = await getOrCreateConversation(phone, c.sender_number, c.workspace_id, c.created_by)
        if (!conversation?.id) continue
        const result = await sendMonitorVoicemail({ recordingUrl, from: c.sender_number, to: phone })
        if (!result.ok) { console.warn('[rvm:monitor] send failed', { campaignId: c.id, phone, msg: result.data?.message }); continue }
        anySent = true
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: c.sender_number,
          to_number: phone,
          body: '[Voicemail · daily monitor]',
          type: 'voicemail',
          recording_url: c.recording_url,
          status: 'sent',
          telnyx_message_id: result?.data?.voice_drop_id || null,
          sent_by: c.created_by,
        })
        await supabaseAdmin.rpc('deduct_wallet_credits', { p_workspace_id: c.workspace_id, p_amount: CREDITS_PER_RVM })
        console.log('[rvm:monitor] heartbeat sent', { campaignId: c.id, phone })
      } catch (e) {
        console.error('[rvm:monitor] error', { campaignId: c.id, phone, error: e.message })
      }
    }

    // If NOTHING landed, release today's claim so a later tick retries instead of
    // staying silent for the whole day. Failed sends don't deduct credits, so
    // retrying is safe. (This is exactly what swallowed Roland's monitor drop.)
    if (!anySent) {
      await supabaseAdmin.from('voicemail_campaigns')
        .update({ monitor_last_sent_at: null })
        .eq('id', c.id)
        .eq('monitor_last_sent_at', now.toISOString())
      console.warn('[rvm:monitor] all monitor sends failed — released day claim for retry', { campaignId: c.id })
    }
  }
}

// Send a monitor/canary voicemail with a couple of retries — a monitor drop is a
// single confirmation send, so a transient trunk/provider hiccup shouldn't make
// it vanish. Returns the last sendStaticVoicemail result.
async function sendMonitorVoicemail({ recordingUrl, from, to }) {
  let result = { ok: false, data: {} }
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await sendStaticVoicemail({ recordingUrl, from, to, statusWebhookUrl: WEBHOOK_URL })
    if (result.ok) return result
    // 429 (rate/concurrency) and transient errors are worth a brief backoff.
    await sleep(SEND_GAP_MS * attempt * 2)
  }
  return result
}

// Fire the monitor/canary voicemail to ONE campaign's monitor numbers IMMEDIATELY
// at launch — BEFORE any real recipients — so the user can instantly confirm the
// audio + sender + delivery path actually works.
//
// Unlike the daily heartbeat (sendMonitorHeartbeats), this deliberately IGNORES
// calling windows/days: it's a confirmation send to the user's OWN number, so it
// shouldn't wait for a business-hours window. It still respects a scheduled start
// (no point confirming before the campaign is meant to begin) and stamps
// monitor_last_sent_at so the daily heartbeat doesn't double-send the same day.
export async function sendMonitorNow(campaignId) {
  const { data: c } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id, status, sender_number, recording_url, recording_path, voicedrop_recording_url, created_by, workspace_id, monitor_numbers, starts_at')
    .eq('id', campaignId)
    .maybeSingle()
  if (!c) return

  const nums = Array.isArray(c.monitor_numbers) ? c.monitor_numbers.filter(Boolean) : []
  if (nums.length === 0) return

  // Hold until a scheduled start has arrived — the cron's daily heartbeat will
  // pick it up once the campaign actually begins.
  if (c.starts_at && new Date(c.starts_at).getTime() > Date.now()) {
    console.log('[rvm:monitor-now] scheduled start not reached — deferring to daily heartbeat', { campaignId })
    return
  }

  const recordingUrl = await resolveRecordingUrl(c)
  if (!recordingUrl) { console.warn('[rvm:monitor-now] no recording url', { campaignId }); return }

  // Claim today's heartbeat up front so the cron doesn't ALSO fire today.
  const claimStamp = new Date().toISOString()
  await supabaseAdmin.from('voicemail_campaigns')
    .update({ monitor_last_sent_at: claimStamp })
    .eq('id', c.id)

  let anySent = false
  for (const phone of nums) {
    try {
      const conversation = await getOrCreateConversation(phone, c.sender_number, c.workspace_id, c.created_by)
      if (!conversation?.id) continue
      const result = await sendMonitorVoicemail({ recordingUrl, from: c.sender_number, to: phone })
      if (!result.ok) { console.warn('[rvm:monitor-now] send failed', { campaignId, phone, msg: result.data?.message }); continue }
      anySent = true
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        from_number: c.sender_number,
        to_number: phone,
        body: '[Voicemail · launch monitor]',
        type: 'voicemail',
        recording_url: c.recording_url,
        status: 'sent',
        telnyx_message_id: result?.data?.voice_drop_id || null,
        sent_by: c.created_by,
      })
      await supabaseAdmin.rpc('deduct_wallet_credits', { p_workspace_id: c.workspace_id, p_amount: CREDITS_PER_RVM })
      console.log('[rvm:monitor-now] launch monitor sent', { campaignId, phone })
    } catch (e) {
      console.error('[rvm:monitor-now] error', { campaignId, phone, error: e.message })
    }
  }

  // Every launch-monitor send failed — release the claim so the cron's daily
  // heartbeat retries (next time it's inside a calling window) instead of the
  // monitor number silently getting nothing all day.
  if (!anySent) {
    await supabaseAdmin.from('voicemail_campaigns')
      .update({ monitor_last_sent_at: null })
      .eq('id', c.id)
      .eq('monitor_last_sent_at', claimStamp)
    console.warn('[rvm:monitor-now] all launch monitor sends failed — released claim for cron retry', { campaignId })
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
    // Nothing got sent but rows were re-queued (provider unreachable). Don't
    // hammer in this tight loop — hand off to the every-minute cron so retries
    // are spaced out and a brief blip has time to recover.
    if (res.sent === 0 && res.requeued > 0) {
      console.warn('[rvm:inline] provider unreachable — deferring retries to cron', { campaignId, ...res })
      return
    }
    // A full batch produced no sends and wasn't a network re-queue → every row
    // was held back by a gate (per-minute pace/concurrency, daily cap, calling
    // window, or claimed by an overlapping sweep). Looping would just spin (and
    // pacing out would risk bursting the trunk), so hand the rest to the cron,
    // which paces one minute at a time.
    if (res.sent === 0 && res.requeued === 0 && res.picked > 0) {
      console.log('[rvm:inline] nothing dispatchable this tick — cron will continue', { campaignId, ...res })
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
