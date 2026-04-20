import { NextResponse } from 'next/server'

// POST /api/calls/transfer
// Uses Telnyx Call Control: POST /calls/{call_control_id}/actions/transfer
// This does a proper blind transfer server-side — no client hackery needed.
export async function POST(request) {
  try {
    const { callControlId, to, from, timeoutSecs = 30 } = await request.json()

    if (!callControlId || !to) {
      return NextResponse.json({ error: 'callControlId and to are required' }, { status: 400 })
    }

    const apiKey = process.env.TELNYX_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Telnyx API key not configured' }, { status: 503 })
    }

    // Normalize destination to E.164
    const cleanTo = to.replace(/\D/g, '')
    const formattedTo = cleanTo.startsWith('1') && cleanTo.length === 11
      ? `+${cleanTo}`
      : cleanTo.length === 10
        ? `+1${cleanTo}`
        : `+${cleanTo}`

    const body = {
      to: formattedTo,
      timeout_secs: timeoutSecs,
    }

    // Optionally set caller ID
    if (from) {
      const cleanFrom = from.replace(/\D/g, '')
      body.from = cleanFrom.startsWith('1') && cleanFrom.length === 11
        ? `+${cleanFrom}`
        : cleanFrom.length === 10
          ? `+1${cleanFrom}`
          : `+${cleanFrom}`
    }

    console.log('[transfer] Transferring call', callControlId.slice(0, 20), 'to', formattedTo)

    const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('[transfer] Telnyx error:', res.status, JSON.stringify(data))
      const detail = data?.errors?.[0]?.detail || 'Transfer failed'
      return NextResponse.json({ error: detail }, { status: res.status })
    }

    console.log('[transfer] Transfer initiated successfully')
    return NextResponse.json({ success: true, data: data.data })
  } catch (error) {
    console.error('[transfer] Error:', error.message)
    return NextResponse.json({ error: 'Transfer failed' }, { status: 500 })
  }
}
