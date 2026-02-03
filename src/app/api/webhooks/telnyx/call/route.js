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

    console.log('Call initiated:', payload.call_control_id)

    // Create call record
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