// POST /api/calls/record-start
// Sends record_start to Telnyx for a live call using the call_control_id.
// Called client-side immediately when a call is answered so recording starts
// regardless of whether the Telnyx webhook is configured.

import { NextResponse } from 'next/server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.TELNYX_API_KEY) {
    return NextResponse.json({ error: 'TELNYX_API_KEY not set' }, { status: 500 })
  }

  const { callControlId } = await request.json().catch(() => ({}))
  console.log('[record-start] ▶️ request received — callControlId:', callControlId)
  if (!callControlId) {
    return NextResponse.json({ error: 'callControlId required' }, { status: 400 })
  }

  const recordUrl = `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`
  console.log('[record-start] calling Telnyx:', recordUrl)

  try {
    const res = await fetch(recordUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        format: 'mp3',
        channels: 'dual',
        play_beep: false,
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      console.log('[record-start] ✅ Telnyx accepted record_start for:', callControlId)
      return NextResponse.json({ success: true })
    } else {
      console.error('[record-start] ❌ Telnyx rejected — status:', res.status, 'body:', JSON.stringify(data))
      const detail = data.errors?.[0]?.detail || data.errors?.[0]?.title || JSON.stringify(data)
      return NextResponse.json({ error: detail, telnyxStatus: res.status, telnyxBody: data }, { status: 502 })
    }
  } catch (e) {
    console.error('[record-start] ❌ Error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
