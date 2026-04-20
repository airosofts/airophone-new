import { NextResponse } from 'next/server'

const TELNYX_API = 'https://api.telnyx.com/v2'

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

// POST /api/calls/conference — Create conference + join existing call + dial participant
export async function POST(request) {
  try {
    const { callControlId, participantNumber, from, conferenceName } = await request.json()

    if (!callControlId || !participantNumber) {
      return NextResponse.json({ error: 'callControlId and participantNumber are required' }, { status: 400 })
    }

    if (!process.env.TELNYX_API_KEY) {
      return NextResponse.json({ error: 'Telnyx API key not configured' }, { status: 503 })
    }

    const name = conferenceName || `conf_${Date.now()}`

    // Step 1: Create conference from the existing call leg
    console.log('[conference] Creating conference from call', callControlId.slice(0, 20))
    const createRes = await fetch(`${TELNYX_API}/conferences`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        call_control_id: callControlId,
        name,
        beep_enabled: 'never',
        start_conference_on_create: true,
        max_participants: 10,
      }),
    })

    const createData = await createRes.json()
    if (!createRes.ok) {
      console.error('[conference] Create error:', createRes.status, JSON.stringify(createData))
      return NextResponse.json({
        error: createData?.errors?.[0]?.detail || 'Failed to create conference',
      }, { status: createRes.status })
    }

    const conferenceId = createData.data?.id
    if (!conferenceId) {
      return NextResponse.json({ error: 'Conference created but no ID returned' }, { status: 500 })
    }

    console.log('[conference] Created conference:', conferenceId, 'name:', name)

    // Step 2: Dial participant into the conference
    const cleanNum = participantNumber.replace(/\D/g, '')
    const formattedTo = cleanNum.startsWith('1') && cleanNum.length === 11
      ? `+${cleanNum}`
      : cleanNum.length === 10
        ? `+1${cleanNum}`
        : `+${cleanNum}`

    let formattedFrom = undefined
    if (from) {
      const cleanFrom = from.replace(/\D/g, '')
      formattedFrom = cleanFrom.startsWith('1') && cleanFrom.length === 11
        ? `+${cleanFrom}`
        : cleanFrom.length === 10
          ? `+1${cleanFrom}`
          : `+${cleanFrom}`
    }

    // Use the connection ID to dial out from the conference
    const dialBody = {
      to: formattedTo,
      conference_id: conferenceId,
      timeout_secs: 30,
    }
    if (formattedFrom) dialBody.from = formattedFrom

    console.log('[conference] Dialing participant', formattedTo, 'into conference', conferenceId)

    // Dial participant using call control — create a new outbound call and join it
    const dialRes = await fetch(`${TELNYX_API}/calls`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        to: formattedTo,
        from: formattedFrom || process.env.TELNYX_FROM,
        connection_id: process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID || process.env.TELNYX_CALL_CONNECTION_ID,
        answering_machine_detection: 'disabled',
        webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx/call`,
      }),
    })

    const dialData = await dialRes.json()
    if (!dialRes.ok) {
      console.error('[conference] Dial error:', dialRes.status, JSON.stringify(dialData))
      // Conference created but participant dial failed — still return conference ID
      return NextResponse.json({
        success: true,
        conferenceId,
        participantError: dialData?.errors?.[0]?.detail || 'Failed to dial participant',
        participantCallControlId: null,
      })
    }

    const participantCallControlId = dialData.data?.call_control_id
    console.log('[conference] Participant call initiated:', participantCallControlId?.slice(0, 20))

    // Step 3: When participant answers, they need to be joined to the conference
    // This happens via webhook — when call.answered fires, we join them.
    // For now, return the IDs so the client can track status.

    return NextResponse.json({
      success: true,
      conferenceId,
      participantCallControlId,
      conferenceName: name,
    })
  } catch (error) {
    console.error('[conference] Error:', error.message)
    return NextResponse.json({ error: 'Conference setup failed' }, { status: 500 })
  }
}

// DELETE /api/calls/conference — End conference
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const conferenceId = searchParams.get('conferenceId')

    if (!conferenceId) {
      return NextResponse.json({ error: 'conferenceId is required' }, { status: 400 })
    }

    const res = await fetch(`${TELNYX_API}/conferences/${conferenceId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    })

    if (!res.ok) {
      const data = await res.json()
      console.error('[conference] Delete error:', res.status, JSON.stringify(data))
    }

    console.log('[conference] Conference ended:', conferenceId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[conference] Delete error:', error.message)
    return NextResponse.json({ error: 'Failed to end conference' }, { status: 500 })
  }
}
