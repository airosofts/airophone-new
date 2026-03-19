// src/app/api/webhooks/telnyx/call/route.js
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function mapDirection(d) {
  if (d === 'incoming') return 'inbound'
  if (d === 'outgoing') return 'outbound'
  return d
}

export async function POST(request) {
  // Always return 200 to prevent Telnyx retries — even if processing fails
  try {
    const body = await request.text()
    const event = JSON.parse(body)
    const eventType = event?.data?.event_type
    const payload = event?.data?.payload

    console.log('[call-webhook]', eventType, payload?.call_control_id, payload?.direction, payload?.from, '->', payload?.to)

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

  return NextResponse.json({ success: true })
}

async function handleCallInitiated(supabase, payload) {
  const callControlId = payload.call_control_id
  const toNumber = payload.to
  const fromNumber = payload.from
  const isIncoming = payload.direction === 'incoming'
  const dbDirection = mapDirection(payload.direction)

  // DB-level dedup: try insert, if unique constraint on telnyx_call_id fails, skip
  // First check to avoid unnecessary processing
  const { data: existing } = await supabase
    .from('calls')
    .select('id, status')
    .eq('telnyx_call_id', callControlId)
    .maybeSingle()

  if (existing) {
    console.log('[call-webhook] Already processed', callControlId, 'status:', existing.status)
    return
  }

  // Resolve workspace from phone number
  const lookupNumber = isIncoming ? toNumber : fromNumber
  const digits = lookupNumber?.replace(/\D/g, '').slice(-10)
  let workspace = null

  if (digits) {
    const { data: phoneRec } = await supabase
      .from('phone_numbers')
      .select('workspace_id, id, phone_number')
      .like('phone_number', `%${digits}`)
      .limit(1)
      .maybeSingle()

    if (phoneRec) {
      workspace = { workspaceId: phoneRec.workspace_id, phoneNumberId: phoneRec.id }
      console.log('[call-webhook] Resolved workspace:', phoneRec.workspace_id)
    }
  }

  // INSERT the call record FIRST (so dedup works even if transfer is slow)
  const { error: insertErr } = await supabase.from('calls').insert({
    telnyx_call_id: callControlId,
    from_number: fromNumber,
    to_number: toNumber,
    direction: dbDirection,
    status: 'initiated',
    workspace_id: workspace?.workspaceId || null,
    created_at: new Date().toISOString()
  })

  if (insertErr) {
    // If it's a unique constraint violation, another webhook already handled this
    if (insertErr.code === '23505') {
      console.log('[call-webhook] Duplicate insert blocked by DB constraint', callControlId)
      return
    }
    console.error('[call-webhook] Insert error:', insertErr.message)
    return
  }

  console.log('[call-webhook] Call record created:', callControlId)

  // Now check forwarding for inbound calls
  if (!isIncoming) return

  const toDigits = toNumber.replace(/\D/g, '').slice(-10)

  // Get active forwarding rules
  let query = supabase
    .from('call_forwarding_rules')
    .select('*, phone_numbers!inner(phone_number)')
    .eq('is_active', true)

  if (workspace?.workspaceId) {
    query = query.eq('workspace_id', workspace.workspaceId)
  }

  const { data: rules } = await query

  if (!rules?.length) {
    console.log('[call-webhook] No forwarding rules')
    return
  }

  const matchedRule = rules.find(r => {
    const ruleDigits = r.phone_numbers?.phone_number?.replace(/\D/g, '').slice(-10)
    return ruleDigits === toDigits
  })

  if (!matchedRule) {
    console.log('[call-webhook] No rule matched for', toNumber)
    return
  }

  console.log('[call-webhook] MATCHED rule:', matchedRule.id, '-> forward to', matchedRule.forward_to)

  // Format destination
  const cleanTo = matchedRule.forward_to.replace(/\D/g, '')
  const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`

  // Try transfer directly (works on unanswered calls in Call Control)
  console.log('[call-webhook] Attempting transfer:', callControlId, '->', formattedTo)

  const transferRes = await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: formattedTo, from: toNumber, command_id: `fwd_${Date.now()}` })
    }
  )

  const transferBody = await transferRes.text()
  console.log('[call-webhook] Transfer response:', transferRes.status, transferBody)

  if (transferRes.ok) {
    // Update the existing record to forwarded
    await supabase.from('calls')
      .update({ status: 'forwarded', forwarded_to: matchedRule.forward_to, forwarding_rule_id: matchedRule.id })
      .eq('telnyx_call_id', callControlId)

    console.log('[call-webhook] Call forwarded successfully!')
    return
  }

  // Transfer failed — try answer first, then transfer
  console.log('[call-webhook] Direct transfer failed, trying answer+transfer...')

  const answerRes = await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command_id: `ans_${Date.now()}` })
    }
  )
  const answerBody = await answerRes.text()
  console.log('[call-webhook] Answer response:', answerRes.status, answerBody)

  // Brief wait for answer to take effect
  await new Promise(r => setTimeout(r, 500))

  // Retry transfer
  const retryRes = await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: formattedTo, from: toNumber, command_id: `fwd2_${Date.now()}` })
    }
  )
  const retryBody = await retryRes.text()
  console.log('[call-webhook] Retry transfer response:', retryRes.status, retryBody)

  if (retryRes.ok) {
    await supabase.from('calls')
      .update({ status: 'forwarded', forwarded_to: matchedRule.forward_to, forwarding_rule_id: matchedRule.id })
      .eq('telnyx_call_id', callControlId)

    console.log('[call-webhook] Call forwarded on retry!')
  } else {
    console.error('[call-webhook] Both transfer attempts failed for', callControlId)
  }
}

async function handleCallHangup(supabase, payload) {
  const endTime = new Date().toISOString()

  const { data: call } = await supabase
    .from('calls')
    .update({ status: 'completed', ended_at: endTime, hangup_cause: payload.hangup_cause || 'normal_clearing', updated_at: endTime })
    .eq('telnyx_call_id', payload.call_control_id)
    .select('id, answered_at')
    .maybeSingle()

  if (call?.answered_at) {
    const duration = Math.floor((new Date(endTime) - new Date(call.answered_at)) / 1000)
    await supabase.from('calls').update({ duration_seconds: duration }).eq('id', call.id)
  }
}

export async function GET() {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
