// src/app/api/webhooks/telnyx/call/route.js
// Records call history only — forwarding is handled by Telnyx natively
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function mapDirection(d) {
  if (d === 'incoming') return 'inbound'
  if (d === 'outgoing') return 'outbound'
  return d
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

  // Resolve workspace
  const digits = (payload.direction === 'incoming' ? toNumber : fromNumber)?.replace(/\D/g, '').slice(-10)
  let workspaceId = null
  let forwardedTo = null

  if (digits) {
    const { data: phoneRec } = await supabase
      .from('phone_numbers')
      .select('workspace_id, id')
      .like('phone_number', `%${digits}`)
      .limit(1)
      .maybeSingle()

    if (phoneRec) {
      workspaceId = phoneRec.workspace_id

      // Check if this number has a forwarding rule (for recording purposes)
      if (payload.direction === 'incoming') {
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
    created_at: new Date().toISOString()
  })

  if (error && error.code !== '23505') {
    console.error('[call-webhook] Insert error:', error.message)
  }
}

async function handleCallHangup(supabase, payload) {
  const endTime = new Date().toISOString()

  const { data: call } = await supabase
    .from('calls')
    .update({ status: 'completed', ended_at: endTime, hangup_cause: payload.hangup_cause || 'normal_clearing', updated_at: endTime })
    .eq('telnyx_call_id', payload.call_control_id)
    .select('id, answered_at, forwarded_to')
    .maybeSingle()

  if (!call) return

  // Don't overwrite 'forwarded' status with 'completed'
  if (call.forwarded_to) {
    await supabase.from('calls')
      .update({ status: 'forwarded', ended_at: endTime })
      .eq('id', call.id)
  }

  if (call.answered_at) {
    const duration = Math.floor((new Date(endTime) - new Date(call.answered_at)) / 1000)
    await supabase.from('calls').update({ duration_seconds: duration }).eq('id', call.id)
  }
}

export async function GET() {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
