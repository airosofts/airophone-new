// src/app/api/webhooks/telnyx/call/route.js
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Telnyx sends 'incoming'/'outgoing' but our DB constraint expects 'inbound'/'outbound'
function mapDirection(telnyxDirection) {
  if (telnyxDirection === 'incoming') return 'inbound'
  if (telnyxDirection === 'outgoing') return 'outbound'
  return telnyxDirection // fallback
}

export async function POST(request) {
  const logs = []
  const log = (msg, data) => {
    const entry = data ? `${msg}: ${JSON.stringify(data)}` : msg
    logs.push(`[${new Date().toISOString()}] ${entry}`)
    console.log('[call-webhook]', entry)
  }

  try {
    const body = await request.text()
    log('Webhook received, body length', body.length)

    const event = JSON.parse(body)
    const eventType = event?.data?.event_type
    const payload = event?.data?.payload

    log('Event type', eventType)
    log('Payload', {
      call_control_id: payload?.call_control_id,
      direction: payload?.direction,
      from: payload?.from,
      to: payload?.to,
      state: payload?.state
    })

    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(payload, log)
        break

      case 'call.answered':
        await handleCallAnswered(payload, log)
        break

      case 'call.hangup':
        await handleCallHangup(payload, log)
        break

      case 'call.recording.saved':
        await handleCallRecordingSaved(payload, log)
        break

      default:
        log('Unhandled event type', eventType)
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    log('FATAL ERROR', { message: error.message, stack: error.stack })
    return NextResponse.json(
      { error: 'Internal server error', logs },
      { status: 500 }
    )
  }
}

async function handleCallInitiated(payload, log) {
  const supabase = createSupabaseServerClient()

  log('Processing call.initiated', payload.call_control_id)

  // Resolve workspace from the phone number being called
  const toNumber = payload.to
  const fromNumber = payload.from
  // Telnyx sends 'incoming' or 'outgoing'
  const isIncoming = payload.direction === 'incoming'
  const dbDirection = mapDirection(payload.direction) // 'inbound' or 'outbound' for DB constraint

  log('Call direction', { telnyxDirection: payload.direction, dbDirection, isIncoming, to: toNumber, from: fromNumber })

  // Find which workspace owns this phone number
  const lookupNumber = isIncoming ? toNumber : fromNumber
  const workspace = await resolveWorkspace(supabase, lookupNumber, log)

  // Check for call forwarding on inbound calls
  if (isIncoming) {
    log('Checking forwarding rules for inbound call to', toNumber)
    const forwarded = await checkAndForwardCall(supabase, payload, workspace, dbDirection, log)
    if (forwarded) {
      log('Call was forwarded, done')
      return
    }
    log('No forwarding rule matched, proceeding with normal call flow')
  }

  // Create normal call record
  const insertData = {
    telnyx_call_id: payload.call_control_id,
    from_number: fromNumber,
    to_number: toNumber,
    direction: dbDirection,
    status: 'initiated',
    workspace_id: workspace?.workspaceId || null,
    created_at: new Date().toISOString()
  }

  log('Inserting call record', insertData)

  const { data: call, error } = await supabase
    .from('calls')
    .insert(insertData)
    .select()
    .single()

  if (error) {
    log('ERROR inserting call record', { code: error.code, message: error.message, details: error.details, hint: error.hint })
    throw error
  }

  log('Call record created', call.id)
}

/**
 * Resolve which workspace owns a phone number
 */
async function resolveWorkspace(supabase, phoneNumber, log) {
  if (!phoneNumber) return null

  const digits = phoneNumber.replace(/\D/g, '')

  // Try exact match first
  const { data: phoneRecord, error } = await supabase
    .from('phone_numbers')
    .select('workspace_id, phone_number, id')
    .or(`phone_number.eq.${phoneNumber},phone_number.eq.+${digits},phone_number.eq.+1${digits}`)
    .limit(1)
    .single()

  if (error || !phoneRecord) {
    log('Could not resolve workspace for number', { phoneNumber, error: error?.message })
    return null
  }

  log('Resolved workspace', { workspaceId: phoneRecord.workspace_id, phoneId: phoneRecord.id })
  return {
    workspaceId: phoneRecord.workspace_id,
    phoneNumberId: phoneRecord.id,
    phoneNumber: phoneRecord.phone_number
  }
}

/**
 * Check if there's an active forwarding rule and transfer the call
 */
async function checkAndForwardCall(supabase, payload, workspace, dbDirection, log) {
  try {
    const toNumber = payload.to
    const toDigits = toNumber.replace(/\D/g, '')

    // Query forwarding rules with their phone numbers
    let query = supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers!inner(phone_number, id)')
      .eq('is_active', true)

    // Scope to workspace if we know it
    if (workspace?.workspaceId) {
      query = query.eq('workspace_id', workspace.workspaceId)
    }

    const { data: rules, error: ruleError } = await query

    if (ruleError) {
      log('ERROR querying forwarding rules', { code: ruleError.code, message: ruleError.message, details: ruleError.details })
      return false
    }

    log('Found forwarding rules', { count: rules?.length || 0, rules: rules?.map(r => ({ id: r.id, forward_to: r.forward_to, phone: r.phone_numbers?.phone_number })) })

    if (!rules || rules.length === 0) {
      log('No active forwarding rules found')
      return false
    }

    // Match the called number against rule phone numbers
    const matchedRule = rules.find(rule => {
      const rulePhone = rule.phone_numbers?.phone_number
      if (!rulePhone) return false
      const ruleDigits = rulePhone.replace(/\D/g, '')
      // Compare last 10 digits (ignore country code differences)
      const toLast10 = toDigits.slice(-10)
      const ruleLast10 = ruleDigits.slice(-10)
      const matched = toLast10 === ruleLast10
      log('Comparing numbers', { to: toNumber, toDigits: toLast10, rulePhone, ruleDigits: ruleLast10, matched })
      return matched
    })

    if (!matchedRule) {
      log('No rule matched the called number', toNumber)
      return false
    }

    log('MATCHED forwarding rule', { ruleId: matchedRule.id, from: toNumber, forwardTo: matchedRule.forward_to })

    // Format destination number
    const cleanTo = matchedRule.forward_to.replace(/\D/g, '')
    const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`

    log('Transferring call via Telnyx API', {
      call_control_id: payload.call_control_id,
      to: formattedTo,
      from: toNumber
    })

    // First, answer the call (required before transfer for incoming calls)
    const answerResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/answer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command_id: `ans_${Date.now()}`
        })
      }
    )

    const answerData = await answerResponse.json()
    log('Answer response', { status: answerResponse.status, data: answerData })

    if (!answerResponse.ok) {
      log('ERROR answering call before transfer', answerData)
      // Try transfer anyway - some call states allow direct transfer
    }

    // Now transfer the call
    const transferResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/transfer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: formattedTo,
          from: toNumber,
          command_id: `fwd_${Date.now()}`
        })
      }
    )

    const transferData = await transferResponse.json()
    log('Transfer response', { status: transferResponse.status, data: transferData })

    if (!transferResponse.ok) {
      log('ERROR transferring call', transferData)
      return false
    }

    log('Call forwarded successfully')

    // Record the forwarded call
    const insertData = {
      telnyx_call_id: payload.call_control_id,
      from_number: payload.from,
      to_number: toNumber,
      direction: dbDirection,
      status: 'forwarded',
      forwarded_to: matchedRule.forward_to,
      forwarding_rule_id: matchedRule.id,
      workspace_id: matchedRule.workspace_id,
      created_at: new Date().toISOString()
    }

    log('Inserting forwarded call record', insertData)

    const { data: call, error: insertError } = await supabase
      .from('calls')
      .insert(insertData)
      .select()
      .single()

    if (insertError) {
      log('ERROR inserting forwarded call record', { code: insertError.code, message: insertError.message, details: insertError.details })
    } else {
      log('Forwarded call record created', call.id)
    }

    return true

  } catch (error) {
    log('EXCEPTION in checkAndForwardCall', { message: error.message, stack: error.stack })
    return false
  }
}

async function handleCallAnswered(payload, log) {
  const supabase = createSupabaseServerClient()

  log('Processing call.answered', payload.call_control_id)

  const { data: call, error } = await supabase
    .from('calls')
    .update({
      status: 'answered',
      answered_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('telnyx_call_id', payload.call_control_id)
    .select()
    .single()

  if (error) {
    log('ERROR updating call to answered', { code: error.code, message: error.message })
    return
  }

  log('Call marked answered', call.id)
}

async function handleCallHangup(payload, log) {
  const supabase = createSupabaseServerClient()

  log('Processing call.hangup', payload.call_control_id)

  const endTime = new Date().toISOString()

  const { data: call, error } = await supabase
    .from('calls')
    .update({
      status: 'completed',
      ended_at: endTime,
      hangup_cause: payload.hangup_cause || 'normal_clearing',
      updated_at: endTime
    })
    .eq('telnyx_call_id', payload.call_control_id)
    .select()
    .single()

  if (error) {
    log('ERROR updating call to completed', { code: error.code, message: error.message })
    return
  }

  // Calculate duration
  if (call.answered_at) {
    const startTime = new Date(call.answered_at)
    const duration = Math.floor((new Date(endTime) - startTime) / 1000)

    await supabase
      .from('calls')
      .update({ duration_seconds: duration })
      .eq('id', call.id)

    log('Call completed with duration', { id: call.id, duration })
  } else {
    log('Call completed (never answered)', call.id)
  }
}

async function handleCallRecordingSaved(payload, log) {
  const supabase = createSupabaseServerClient()

  log('Processing call.recording.saved', payload.call_control_id)

  const { data: call, error } = await supabase
    .from('calls')
    .update({
      recording_url: payload.recording_urls?.mp3 || payload.recording_urls?.wav,
      has_recording: true,
      updated_at: new Date().toISOString()
    })
    .eq('telnyx_call_id', payload.call_control_id)
    .select()
    .single()

  if (error) {
    log('ERROR updating recording', { code: error.code, message: error.message })
    return
  }

  log('Recording saved for call', call.id)
}

export async function GET(request) {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
