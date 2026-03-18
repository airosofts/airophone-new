// src/app/api/webhooks/telnyx/call/route.js
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const body = await request.text()
    const signature = request.headers.get('telnyx-signature-ed25519')
    const timestamp = request.headers.get('telnyx-timestamp')

    console.log('Received Telnyx call webhook:', body)

    // Parse the webhook event
    const event = JSON.parse(body)

    // Handle different call event types
    switch (event.data.event_type) {
      case 'call.initiated':
        await handleCallInitiated(event.data)
        break

      case 'call.answered':
        await handleCallAnswered(event.data)
        break

      case 'call.hangup':
        await handleCallHangup(event.data)
        break

      case 'call.recording.saved':
        await handleCallRecordingSaved(event.data)
        break

      default:
        console.log(`Unhandled call event type: ${event.data.event_type}`)
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error processing Telnyx call webhook:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function handleCallInitiated(eventData) {
  try {
    const supabase = createSupabaseServerClient()
    const payload = eventData.payload

    console.log('Call initiated:', payload.call_control_id, 'direction:', payload.direction)

    // Check for call forwarding on inbound calls
    if (payload.direction === 'incoming') {
      const forwardResult = await checkAndForwardCall(supabase, payload)
      if (forwardResult) {
        // Call was forwarded, record is already created in checkAndForwardCall
        return
      }
    }

    // Default: create normal call record
    const { data: call, error } = await supabase
      .from('calls')
      .insert({
        telnyx_call_id: payload.call_control_id,
        from_number: payload.from,
        to_number: payload.to,
        direction: payload.direction,
        status: 'initiated',
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating call record:', error)
      throw error
    }

    console.log('Call record created:', call.id)

  } catch (error) {
    console.error('Error handling call initiated:', error)
    throw error
  }
}

/**
 * Check if there's an active forwarding rule for the called number
 * and transfer the call if so.
 */
async function checkAndForwardCall(supabase, payload) {
  try {
    const toNumber = payload.to

    // Normalize the number for matching (try with and without +1)
    const digits = toNumber.replace(/\D/g, '')
    const variations = [
      toNumber,
      `+${digits}`,
      `+1${digits}`,
      digits.startsWith('1') ? `+${digits}` : `+1${digits}`
    ]

    // Find active forwarding rule matching the called number
    const { data: rules, error: ruleError } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers!inner(phone_number)')
      .eq('is_active', true)

    if (ruleError || !rules || rules.length === 0) {
      return false
    }

    // Match against our phone numbers
    const matchedRule = rules.find(rule => {
      const rulePhone = rule.phone_numbers?.phone_number
      if (!rulePhone) return false
      const ruleDigits = rulePhone.replace(/\D/g, '')
      return variations.some(v => {
        const vDigits = v.replace(/\D/g, '')
        return vDigits === ruleDigits || vDigits.endsWith(ruleDigits) || ruleDigits.endsWith(vDigits)
      })
    })

    if (!matchedRule) {
      return false
    }

    console.log(`Call forwarding matched: ${toNumber} -> ${matchedRule.forward_to} (rule: ${matchedRule.id})`)

    // Transfer the call via Telnyx Call Control API
    const cleanTo = matchedRule.forward_to.replace(/\D/g, '')
    const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`

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

    if (!transferResponse.ok) {
      console.error('Call forwarding transfer failed:', transferData)
      return false
    }

    console.log('Call forwarded successfully:', transferData)

    // Create call record with forwarding info
    const { data: call, error: insertError } = await supabase
      .from('calls')
      .insert({
        telnyx_call_id: payload.call_control_id,
        from_number: payload.from,
        to_number: toNumber,
        direction: 'incoming',
        status: 'forwarded',
        forwarded_to: matchedRule.forward_to,
        forwarding_rule_id: matchedRule.id,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating forwarded call record:', insertError)
    } else {
      console.log('Forwarded call record created:', call.id)
    }

    return true

  } catch (error) {
    console.error('Error in checkAndForwardCall:', error)
    return false
  }
}

async function handleCallAnswered(eventData) {
  try {
    const supabase = createSupabaseServerClient()
    const payload = eventData.payload

    console.log('Call answered:', payload.call_control_id)

    // Update call record
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
      console.error('Error updating call record:', error)
      throw error
    }

    console.log('Call answered and updated:', call.id)

  } catch (error) {
    console.error('Error handling call answered:', error)
    throw error
  }
}

async function handleCallHangup(eventData) {
  try {
    const supabase = createSupabaseServerClient()
    const payload = eventData.payload

    console.log('Call hangup:', payload.call_control_id)

    // Calculate duration if we have start time
    const endTime = new Date().toISOString()

    // Update call record
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
      console.error('Error updating call record:', error)
      throw error
    }

    // Calculate and update duration
    if (call.answered_at) {
      const startTime = new Date(call.answered_at)
      const duration = Math.floor((new Date(endTime) - startTime) / 1000)

      await supabase
        .from('calls')
        .update({ duration_seconds: duration })
        .eq('id', call.id)
    }

    console.log('Call completed and updated:', call.id)

  } catch (error) {
    console.error('Error handling call hangup:', error)
    throw error
  }
}

async function handleCallRecordingSaved(eventData) {
  try {
    const supabase = createSupabaseServerClient()
    const payload = eventData.payload

    console.log('Call recording saved:', payload.call_control_id)

    // Update call record with recording info
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
      console.error('Error updating call record with recording:', error)
      throw error
    }

    console.log('Call recording info updated:', call.id)

  } catch (error) {
    console.error('Error handling call recording saved:', error)
    throw error
  }
}

export async function GET(request) {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
