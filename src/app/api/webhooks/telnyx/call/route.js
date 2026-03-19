// src/app/api/webhooks/telnyx/call/route.js
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Telnyx sends 'incoming'/'outgoing' but our DB constraint expects 'inbound'/'outbound'
function mapDirection(telnyxDirection) {
  if (telnyxDirection === 'incoming') return 'inbound'
  if (telnyxDirection === 'outgoing') return 'outbound'
  return telnyxDirection
}

export async function POST(request) {
  const log = (msg, data) => {
    const entry = data ? `${msg}: ${JSON.stringify(data)}` : msg
    console.log('[call-webhook]', entry)
  }

  try {
    const body = await request.text()

    // Return 200 IMMEDIATELY so Telnyx doesn't retry
    // Process the event in the background
    const event = JSON.parse(body)
    const eventType = event?.data?.event_type
    const payload = event?.data?.payload

    log('Event', { type: eventType, call_control_id: payload?.call_control_id, direction: payload?.direction, from: payload?.from, to: payload?.to })

    // Don't await — process in background so we return 200 fast
    processEvent(eventType, payload, log).catch(err => {
      log('Background processing error', { message: err.message })
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    log('Parse error', { message: error.message })
    // Still return 200 to prevent Telnyx retries
    return NextResponse.json({ success: true })
  }
}

async function processEvent(eventType, payload, log) {
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
      log('Unhandled event', eventType)
  }
}

async function handleCallInitiated(payload, log) {
  const supabase = createSupabaseServerClient()
  const callControlId = payload.call_control_id
  const toNumber = payload.to
  const fromNumber = payload.from
  const isIncoming = payload.direction === 'incoming'
  const dbDirection = mapDirection(payload.direction)

  // DEDUP: Check if we already processed this call_control_id
  const { data: existing } = await supabase
    .from('calls')
    .select('id')
    .eq('telnyx_call_id', callControlId)
    .maybeSingle()

  if (existing) {
    log('Duplicate webhook, already processed', callControlId)
    return
  }

  // Resolve workspace
  const lookupNumber = isIncoming ? toNumber : fromNumber
  const workspace = await resolveWorkspace(supabase, lookupNumber, log)

  // Check forwarding for inbound calls
  if (isIncoming) {
    const forwarded = await checkAndForwardCall(supabase, payload, workspace, dbDirection, log)
    if (forwarded) return
  }

  // Insert normal call record
  const { error } = await supabase
    .from('calls')
    .insert({
      telnyx_call_id: callControlId,
      from_number: fromNumber,
      to_number: toNumber,
      direction: dbDirection,
      status: 'initiated',
      workspace_id: workspace?.workspaceId || null,
      created_at: new Date().toISOString()
    })

  if (error) {
    log('Insert error', { code: error.code, message: error.message })
  } else {
    log('Call record created', callControlId)
  }
}

async function resolveWorkspace(supabase, phoneNumber, log) {
  if (!phoneNumber) return null
  const digits = phoneNumber.replace(/\D/g, '')
  const last10 = digits.slice(-10)

  // Search by last 10 digits using ilike
  const { data: phoneRecords, error } = await supabase
    .from('phone_numbers')
    .select('workspace_id, phone_number, id')
    .like('phone_number', `%${last10}`)
    .limit(1)

  if (error || !phoneRecords?.length) {
    log('Workspace not found for', phoneNumber)
    return null
  }

  const rec = phoneRecords[0]
  log('Resolved workspace', { workspaceId: rec.workspace_id, phone: rec.phone_number })
  return { workspaceId: rec.workspace_id, phoneNumberId: rec.id, phoneNumber: rec.phone_number }
}

async function checkAndForwardCall(supabase, payload, workspace, dbDirection, log) {
  try {
    const toNumber = payload.to
    const toDigits = toNumber.replace(/\D/g, '').slice(-10)

    // Get active forwarding rules
    let query = supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers!inner(phone_number, id)')
      .eq('is_active', true)

    if (workspace?.workspaceId) {
      query = query.eq('workspace_id', workspace.workspaceId)
    }

    const { data: rules, error: ruleError } = await query

    if (ruleError || !rules?.length) {
      log('No forwarding rules found', ruleError?.message)
      return false
    }

    // Match called number
    const matchedRule = rules.find(rule => {
      const ruleDigits = rule.phone_numbers?.phone_number?.replace(/\D/g, '').slice(-10)
      return ruleDigits && toDigits === ruleDigits
    })

    if (!matchedRule) {
      log('No rule matched', toNumber)
      return false
    }

    log('MATCHED rule', { ruleId: matchedRule.id, forwardTo: matchedRule.forward_to })

    // Format destination
    const cleanTo = matchedRule.forward_to.replace(/\D/g, '')
    const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`

    // Transfer directly — do NOT answer first.
    // On Telnyx Call Control, transfer works on unanswered incoming calls.
    log('Transferring', { call_control_id: payload.call_control_id, to: formattedTo })

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
    log('Transfer response', { status: transferResponse.status, ok: transferResponse.ok, data: transferData })

    if (!transferResponse.ok) {
      log('Transfer FAILED, trying answer+transfer fallback')

      // Fallback: answer first, then transfer
      const answerRes = await fetch(
        `https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/answer`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ command_id: `ans_${Date.now()}` })
        }
      )
      log('Answer response', { status: answerRes.status })

      // Wait briefly for the call to be answered
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Try transfer again
      const retryRes = await fetch(
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
            command_id: `fwd2_${Date.now()}`
          })
        }
      )
      const retryData = await retryRes.json()
      log('Retry transfer response', { status: retryRes.status, data: retryData })

      if (!retryRes.ok) {
        log('Both transfer attempts failed')
        // Still insert a record so we track the call
        await supabase.from('calls').insert({
          telnyx_call_id: payload.call_control_id,
          from_number: payload.from,
          to_number: toNumber,
          direction: dbDirection,
          status: 'initiated',
          workspace_id: matchedRule.workspace_id,
          created_at: new Date().toISOString()
        })
        return false
      }
    }

    // Transfer succeeded — record it
    log('Call forwarded successfully!')
    await supabase.from('calls').insert({
      telnyx_call_id: payload.call_control_id,
      from_number: payload.from,
      to_number: toNumber,
      direction: dbDirection,
      status: 'forwarded',
      forwarded_to: matchedRule.forward_to,
      forwarding_rule_id: matchedRule.id,
      workspace_id: matchedRule.workspace_id,
      created_at: new Date().toISOString()
    })

    return true

  } catch (error) {
    log('Forward exception', { message: error.message })
    return false
  }
}

async function handleCallAnswered(payload, log) {
  const supabase = createSupabaseServerClient()
  const { error } = await supabase
    .from('calls')
    .update({ status: 'answered', answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('telnyx_call_id', payload.call_control_id)

  if (error) log('Answer update error', error.message)
  else log('Call answered', payload.call_control_id)
}

async function handleCallHangup(payload, log) {
  const supabase = createSupabaseServerClient()
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
    log('Hangup update error', error.message)
    return
  }

  if (call?.answered_at) {
    const duration = Math.floor((new Date(endTime) - new Date(call.answered_at)) / 1000)
    await supabase.from('calls').update({ duration_seconds: duration }).eq('id', call.id)
    log('Call completed', { id: call.id, duration })
  } else {
    log('Call completed (not answered)', call?.id)
  }
}

async function handleCallRecordingSaved(payload, log) {
  const supabase = createSupabaseServerClient()
  const { error } = await supabase
    .from('calls')
    .update({
      recording_url: payload.recording_urls?.mp3 || payload.recording_urls?.wav,
      has_recording: true,
      updated_at: new Date().toISOString()
    })
    .eq('telnyx_call_id', payload.call_control_id)

  if (error) log('Recording update error', error.message)
  else log('Recording saved', payload.call_control_id)
}

export async function GET(request) {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
