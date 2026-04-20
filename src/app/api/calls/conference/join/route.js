import { NextResponse } from 'next/server'

// POST /api/calls/conference/join — Join a call leg to an existing conference
export async function POST(request) {
  try {
    const { conferenceId, callControlId } = await request.json()

    if (!conferenceId || !callControlId) {
      return NextResponse.json({ error: 'conferenceId and callControlId are required' }, { status: 400 })
    }

    const res = await fetch(
      `https://api.telnyx.com/v2/conferences/${conferenceId}/actions/join`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ call_control_id: callControlId }),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('[conference-join] Error:', res.status, JSON.stringify(data))
      return NextResponse.json({
        error: data?.errors?.[0]?.detail || 'Failed to join conference',
      }, { status: res.status })
    }

    console.log('[conference-join] Call', callControlId.slice(0, 20), 'joined conference', conferenceId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[conference-join] Error:', error.message)
    return NextResponse.json({ error: 'Failed to join conference' }, { status: 500 })
  }
}
