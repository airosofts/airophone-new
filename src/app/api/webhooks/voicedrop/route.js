// Webhook receiving delivery-status updates from VoiceDrop.
//
// VoiceDrop sends multiple status updates per send (scheduled → delivered or
// not-delivered). We match by voice_drop_id (stored in messages.telnyx_message_id)
// and flip the message status so the chat window's "Not delivered" pill works
// identically to SMS.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { finalizeRvmCampaign } from '@/lib/rvm-queue'

// Reflect a delivery result onto the campaign send-row (so campaign completion
// tracks actual delivery, not just dispatch) and re-finalize the campaign.
// `messageId` is the matched messages.id; `delivered` true→delivered, false→failed.
async function applyDeliveryToCampaign(messageId, delivered) {
  if (!messageId) return
  const { data: sendRow } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id, campaign_id')
    .eq('message_id', messageId)
    .maybeSingle()
  if (!sendRow) return   // not a campaign send (e.g. a one-off voicemail)
  await supabaseAdmin
    .from('voicemail_campaign_sends')
    .update({ status: delivered ? 'delivered' : 'failed', delivered_at: new Date().toISOString() })
    .eq('id', sendRow.id)
  await finalizeRvmCampaign(sendRow.campaign_id)
}

export async function POST(request) {
  // Read the RAW body first and log it UNCONDITIONALLY. Previously we called
  // request.json() up front and 400'd before logging if it threw — so a callback
  // sent as form-encoded (or with a non-JSON content-type) was rejected with ZERO
  // trace, making it look like VoiceDrop never called us. Now every inbound hit is
  // visible, and we accept both JSON and form-encoded bodies.
  const contentType = request.headers.get('content-type') || ''
  const raw = await request.text().catch(() => '')
  console.log('[voicedrop:webhook] inbound', { contentType, length: raw.length, body: raw.slice(0, 2000) })

  let payload = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      // Fall back to form-urlencoded (status=delivered&sent_to=...&voice_drop_id=...)
      try {
        const params = new URLSearchParams(raw)
        if ([...params.keys()].length > 0) payload = Object.fromEntries(params.entries())
      } catch { /* leave payload null */ }
    }
  }

  if (!payload || typeof payload !== 'object') {
    console.warn('[voicedrop:webhook] could not parse body', { contentType, length: raw.length })
    // Return 200 so VoiceDrop doesn't disable the webhook for repeated 4xx, but
    // make it clear we couldn't read it — the raw log above shows the real shape.
    return NextResponse.json({ received: true, note: 'unparseable body (logged raw)' })
  }

  console.log('[voicedrop:webhook]', JSON.stringify(payload))

  const status = String(payload.status || '').toLowerCase()
  // VoiceDrop statuses seen so far: scheduled, skipped, failed, delivered,
  // not-delivered — plus carrier dispositions like "FAS" that may arrive as the
  // status itself rather than inside extra_status_info.
  let newStatus = null
  let errorMessage = null
  let errorCode = null

  // CONSERVATIVE mapping — RVM deposits with a delay (often 20s+) and VoiceDrop's
  // callbacks are intermittent/intermediate, so we must NOT mark "not delivered" on
  // an ambiguous status. Only an EXPLICIT, known failure flips a row to failed:
  //   • delivered*                         → delivered
  //   • not-delivered / failed* / skipped* / FAS → failed
  //   • ANYTHING ELSE (scheduled, queued, sent, processing, blank, or a status we
  //     don't recognize) → NON-terminal: leave the row 'sent' and wait. Worst case
  //     it stays 'sent' (an honest "handed off") rather than a false "not delivered".
  // An explicit FAS may arrive either as the status itself or in extra_status_info.
  const extraInfo = String(payload.extra_status_info || '').toLowerCase()
  const isKnownFailure =
       status === 'not-delivered' || status === 'undelivered'
    || status === 'failed' || status.startsWith('failed')
    || status.startsWith('skipped')
    || status === 'fas' || extraInfo === 'fas'

  if (status.startsWith('delivered')) {
    newStatus = 'delivered'
  } else if (isKnownFailure) {
    newStatus = 'failed'
    // payload.reason / payload.error carries an explicit failure reason; VoiceDrop
    // also sends extra_status_info (e.g. "FAS") with carrier-level detail. payload.message
    // is just the generic queue-confirmation text — ignore it. The most common real
    // causes are recipient-side: no mailbox set up, mailbox full, or carrier FAS
    // (Failed Answer Supervision) — NOT sender verification.
    const extra = extraInfo && extraInfo !== 'pending' ? ` (${payload.extra_status_info})` : ''
    errorMessage = (payload.reason || payload.error || payload.failure_reason || (
        status === 'not-delivered' || status === 'undelivered' ? 'Not delivered — recipient could not receive the voicemail (no mailbox set up, mailbox full, or carrier returned FAS)'
      : status.startsWith('skipped') ? 'Skipped — recipient phone could not receive the voicemail'
      : status === 'fas' || extraInfo === 'fas' ? 'Not delivered — carrier returned FAS (Failed Answer Supervision)'
      : 'Send failed'
    )) + extra
    errorCode = 'voicedrop_' + (status || extraInfo).replace(/[^a-z]/g, '_')
  } else {
    // Non-terminal / unknown — do nothing, wait for a definitive event.
    newStatus = null
  }

  if (!newStatus) {
    return NextResponse.json({ received: true, note: `non-terminal/ignored status: ${status || '(none)'}` })
  }

  const update = { status: newStatus }
  if (newStatus === 'delivered') {
    update.delivered_at = new Date().toISOString()
    update.error_code = null
    update.error_message = null
  } else if (newStatus === 'failed') {
    update.error_code = errorCode
    update.error_message = errorMessage
    update.error_details = JSON.stringify({
      error_code: errorCode,
      error_message: errorMessage,
      voicedrop_status: status,
      raw_payload: payload,
      received_at: new Date().toISOString(),
    })
  }

  // VoiceDrop's delivery payload uses sent_to / sent_from / voice_drop_id (confirmed
  // by VoiceDrop support). Older/alternate field names kept as fallbacks in case the
  // schema varies across event types.
  const voiceDropId = payload.voice_drop_id || payload.id || payload.job_id || payload.request_id
  const toPhone = payload.sent_to || payload.to || payload.recipient || payload.phone_number
  const fromPhone = payload.sent_from || payload.from

  const normalize = (p) => String(p || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')

  // 1) Preferred: match by voice_drop_id IF we ever captured one for this send.
  // The /ringless_voicemail send RESPONSE returns no id, so telnyx_message_id is
  // null on a fresh send — this path only hits once an earlier webhook (below)
  // has backfilled the id, e.g. for a follow-up retry event on the same send.
  if (voiceDropId) {
    const { data: updatedMsgs } = await supabaseAdmin
      .from('messages')
      .update(update)
      .eq('telnyx_message_id', voiceDropId)
      .select('id')

    if (updatedMsgs && updatedMsgs.length > 0) {
      await applyDeliveryToCampaign(updatedMsgs[0].id, newStatus === 'delivered')
      return NextResponse.json({ received: true, matched: 'by_id' })
    }
  }

  // 2) Primary path: match by recipient (sent_to) — scoped by sender (sent_from)
  // when present so two campaigns to the same number can't collide — among recent
  // voicemail sends still awaiting a disposition. On match we BACKFILL
  // telnyx_message_id = voice_drop_id so any later event for this same send matches
  // instantly by id. Phone formats vary (stored E.164 vs payload's bare "1503…"),
  // so we normalize both sides in JS rather than in the query.
  if (toPhone) {
    const normalizedTo = normalize(toPhone)
    const normalizedFrom = fromPhone ? normalize(fromPhone) : null
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('id, to_number, from_number')
      .eq('type', 'voicemail')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(200)

    const candidates = msgs || []
    // Prefer an exact (to + from) match; fall back to to-only if the sender
    // didn't line up (e.g. legacy rows with a differently-formatted from_number).
    let match = normalizedFrom
      ? candidates.find(m => normalize(m.to_number) === normalizedTo && normalize(m.from_number) === normalizedFrom)
      : null
    if (!match) match = candidates.find(m => normalize(m.to_number) === normalizedTo)

    if (match) {
      await supabaseAdmin.from('messages')
        .update({ ...update, ...(voiceDropId ? { telnyx_message_id: voiceDropId } : {}) })
        .eq('id', match.id)
      await applyDeliveryToCampaign(match.id, newStatus === 'delivered')
      return NextResponse.json({ received: true, matched: normalizedFrom ? 'by_phone_pair' : 'by_phone' })
    }
  }

  console.warn('[voicedrop:webhook] could not match message', { voiceDropId, toPhone, fromPhone, status })
  return NextResponse.json({ received: true, note: 'no matching message found' })
}
