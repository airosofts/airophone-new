// Webhook receiving delivery-status updates from VoiceDrop.
//
// VoiceDrop sends multiple status updates per send (scheduled → delivered or
// not-delivered). We match by voice_drop_id (stored in messages.telnyx_message_id)
// and flip the message status so the chat window's "Not delivered" pill works
// identically to SMS.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  const payload = await request.json().catch(() => null)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  console.log('[voicedrop:webhook]', JSON.stringify(payload))

  const status = String(payload.status || '').toLowerCase()
  // VoiceDrop statuses: scheduled, skipped, failed, delivered, not-delivered
  let newStatus = null
  let errorMessage = null
  let errorCode = null

  if (status.startsWith('delivered')) {
    newStatus = 'delivered'
  } else if (status === 'not-delivered' || status === 'failed' || status.startsWith('failed') || status.startsWith('skipped')) {
    newStatus = 'failed'
    // payload.reason or payload.error carries the actual failure reason.
    // payload.message is VoiceDrop's generic queue-confirmation text — ignore it.
    errorMessage = payload.reason || payload.error || payload.failure_reason || (
        status === 'not-delivered' ? 'Not delivered — sender number may not be verified with VoiceDrop'
      : status.startsWith('skipped') ? 'Skipped (recipient phone could not receive RVM)'
      : 'Send failed'
    )
    errorCode = 'voicedrop_' + status.replace(/[^a-z]/g, '_')
  }

  if (!newStatus) {
    return NextResponse.json({ received: true, note: `non-terminal status: ${status}` })
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

  // Try matching by voice_drop_id first (preferred, if VoiceDrop sends it in webhook)
  const voiceDropId = payload.voice_drop_id || payload.id || payload.job_id || payload.request_id
  if (voiceDropId) {
    const { count } = await supabaseAdmin
      .from('messages')
      .update(update)
      .eq('telnyx_message_id', voiceDropId)
      .select('id', { count: 'exact', head: true })

    if (count && count > 0) {
      return NextResponse.json({ received: true, matched: 'by_id' })
    }
  }

  // Fallback: match by recipient phone + type='voicemail' + recent sent status.
  // VoiceDrop's initial response doesn't always include an ID, so telnyx_message_id
  // may be null. We match by the `to` phone number and grab the most recent voicemail
  // message for that number that hasn't been given a terminal status yet.
  const toPhone = payload.to || payload.recipient || payload.phone_number
  if (toPhone) {
    const normalizedTo = toPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('id, to_number')
      .eq('type', 'voicemail')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(20)

    const match = msgs?.find(m => {
      const d = (m.to_number || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
      return d === normalizedTo
    })

    if (match) {
      await supabaseAdmin.from('messages').update(update).eq('id', match.id)
      return NextResponse.json({ received: true, matched: 'by_phone' })
    }
  }

  console.warn('[voicedrop:webhook] could not match message', { voiceDropId, toPhone, status })
  return NextResponse.json({ received: true, note: 'no matching message found' })
}
