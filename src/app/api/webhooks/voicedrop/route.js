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

  const voiceDropId = payload.voice_drop_id || payload.id
  if (!voiceDropId) {
    return NextResponse.json({ received: true, note: 'no voice_drop_id in payload' })
  }

  const status = String(payload.status || '').toLowerCase()
  // VoiceDrop statuses: scheduled, skipped, failed, delivered, not-delivered
  let newStatus = null
  let errorMessage = null
  let errorCode = null

  if (status.startsWith('delivered')) {
    newStatus = 'delivered'
  } else if (status === 'not-delivered' || status === 'failed' || status.startsWith('failed') || status.startsWith('skipped')) {
    newStatus = 'failed'
    errorMessage = payload.message || payload.error || (
        status === 'not-delivered' ? 'Could not be delivered'
      : status.startsWith('skipped') ? 'Skipped (recipient validation failed)'
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
      received_at: new Date().toISOString(),
    })
  }

  await supabaseAdmin
    .from('messages')
    .update(update)
    .eq('telnyx_message_id', voiceDropId) // we reuse this column to store voice_drop_id

  return NextResponse.json({ received: true })
}
