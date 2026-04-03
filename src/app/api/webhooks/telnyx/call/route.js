// src/app/api/webhooks/telnyx/call/route.js
// Records call history and links calls to conversations
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function mapDirection(d) {
  if (d === 'incoming') return 'inbound'
  if (d === 'outgoing') return 'outbound'
  return d
}

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+1${digits}`
}

export async function POST(request) {
  try {
    const body = await request.text()
    const event = JSON.parse(body)
    const eventType = event?.data?.event_type
    const payload = event?.data?.payload

    console.log('[call-webhook]', eventType, payload?.call_control_id?.slice(0, 20), payload?.from, '->', payload?.to)

    const supabase = createSupabaseServerClient()

    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(supabase, payload)
        break
      case 'call.answered':
        await supabase.from('calls')
          .update({ status: 'answered', answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('telnyx_call_id', payload.call_control_id)
        break
      case 'call.hangup':
        await handleCallHangup(supabase, payload)
        break
      case 'call.recording.saved':
        await supabase.from('calls')
          .update({ recording_url: payload.recording_urls?.mp3 || payload.recording_urls?.wav, has_recording: true, updated_at: new Date().toISOString() })
          .eq('telnyx_call_id', payload.call_control_id)
        break
    }
  } catch (err) {
    console.error('[call-webhook] ERROR:', err.message)
  }

  // Always return 200
  return NextResponse.json({ success: true })
}

async function findOrCreateConversation(supabase, contactNumber, ourNumber, workspaceId) {
  const normalizedContact = normalizePhoneNumber(contactNumber)
  const normalizedOur = normalizePhoneNumber(ourNumber)

  if (!normalizedContact || !normalizedOur) return null

  // Try to find existing conversation
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('phone_number', normalizedContact)
    .eq('from_number', normalizedOur)
    .maybeSingle()

  if (existing) return existing.id

  // Create new conversation
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      phone_number: normalizedContact,
      from_number: normalizedOur,
      workspace_id: workspaceId,
      status: 'open',
      last_message_at: new Date().toISOString()
    })
    .select('id')
    .single()

  if (error) {
    console.error('[call-webhook] Error creating conversation:', error.message)
    // Try once more in case of race condition (upsert)
    const { data: retry } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', normalizedContact)
      .eq('from_number', normalizedOur)
      .maybeSingle()
    return retry?.id || null
  }

  return created?.id || null
}

async function handleCallInitiated(supabase, payload) {
  const callControlId = payload.call_control_id
  const toNumber = payload.to
  const fromNumber = payload.from
  const dbDirection = mapDirection(payload.direction)

  // Dedup
  const { data: existing } = await supabase
    .from('calls')
    .select('id')
    .eq('telnyx_call_id', callControlId)
    .maybeSingle()

  if (existing) return

  // Resolve workspace and phone record
  const isIncoming = payload.direction === 'incoming'
  const ourNumber = isIncoming ? toNumber : fromNumber
  const contactNumber = isIncoming ? fromNumber : toNumber
  const digits = ourNumber?.replace(/\D/g, '').slice(-10)

  let workspaceId = null
  let forwardedTo = null
  let conversationId = null

  if (digits) {
    const { data: phoneRec } = await supabase
      .from('phone_numbers')
      .select('workspace_id, id, phone_number')
      .like('phone_number', `%${digits}`)
      .limit(1)
      .maybeSingle()

    if (phoneRec) {
      workspaceId = phoneRec.workspace_id

      // Check forwarding rule for incoming calls
      if (isIncoming) {
        const { data: fwdRule } = await supabase
          .from('call_forwarding_rules')
          .select('forward_to, id')
          .eq('phone_number_id', phoneRec.id)
          .eq('is_active', true)
          .maybeSingle()

        if (fwdRule) {
          forwardedTo = fwdRule.forward_to
        }
      }

      // Link to conversation
      conversationId = await findOrCreateConversation(supabase, contactNumber, ourNumber, workspaceId)
    }
  }

  const { error } = await supabase.from('calls').insert({
    telnyx_call_id: callControlId,
    from_number: fromNumber,
    to_number: toNumber,
    direction: dbDirection,
    status: forwardedTo ? 'forwarded' : 'initiated',
    forwarded_to: forwardedTo,
    workspace_id: workspaceId,
    conversation_id: conversationId,
    created_at: new Date().toISOString()
  })

  if (error && error.code !== '23505') {
    console.error('[call-webhook] Insert error:', error.message)
  }
}

async function handleCallHangup(supabase, payload) {
  const endTime = new Date().toISOString()
  const hangupCause = payload.hangup_cause || 'normal_clearing'

  const { data: call } = await supabase
    .from('calls')
    .update({ ended_at: endTime, hangup_cause: hangupCause, updated_at: endTime })
    .eq('telnyx_call_id', payload.call_control_id)
    .select('id, status, answered_at, forwarded_to')
    .maybeSingle()

  if (!call) return

  // Determine final status
  let finalStatus = 'completed'
  if (call.forwarded_to) {
    finalStatus = 'forwarded'
  } else if (!call.answered_at && hangupCause !== 'normal_clearing') {
    finalStatus = 'missed'
  } else if (!call.answered_at) {
    finalStatus = 'missed'
  }

  const updates = { status: finalStatus }

  if (call.answered_at) {
    updates.duration_seconds = Math.floor((new Date(endTime) - new Date(call.answered_at)) / 1000)
  }

  await supabase.from('calls').update(updates).eq('id', call.id)
}

export async function GET() {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
