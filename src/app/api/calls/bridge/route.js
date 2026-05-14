// Telnyx Call Control bridge — used by the mobile app, where in-browser
// WebRTC isn't available. We originate two outbound legs and have Telnyx
// auto-bridge them once both are connected:
//   leg A: workspace_number → user's personal mobile (callback)
//   leg B: workspace_number → recipient (linked to leg A)
//
// `link_to` tells Telnyx to bridge call B to call A as soon as B answers,
// which means the user picks up first (hears their phone ring) and then
// the recipient gets dialled with the workspace number as caller ID.

import { NextResponse } from 'next/server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const TELNYX_API = 'https://api.telnyx.com/v2/calls'

function normalize(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (String(phone).startsWith('+')) return String(phone)
  return `+${digits}`
}

async function originate({ to, from, connection_id, link_to }) {
  const body = {
    to,
    from,
    connection_id,
    timeout_secs: 30,
    time_limit_secs: 1800,
    command_id: `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  }
  if (link_to) body.link_to = link_to

  const res = await fetch(TELNYX_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { to, from, callbackNumber } = await request.json()
    if (!to || !from || !callbackNumber) {
      return NextResponse.json(
        { error: 'Missing required fields: to, from, callbackNumber' },
        { status: 400 }
      )
    }

    const normalizedTo = normalize(to)
    const normalizedFrom = normalize(from)
    const normalizedCallback = normalize(callbackNumber)

    const connectionId =
      process.env.TELNYX_CALL_CONNECTION_ID ||
      process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID

    if (!connectionId) {
      return NextResponse.json(
        { error: 'Server is missing TELNYX_CALL_CONNECTION_ID' },
        { status: 500 }
      )
    }

    // Leg A — dial the user's personal mobile first
    const legA = await originate({
      to: normalizedCallback,
      from: normalizedFrom,
      connection_id: connectionId,
    })

    if (!legA.ok) {
      console.error('[calls/bridge] leg A failed:', legA.data)
      return NextResponse.json(
        { error: 'Failed to dial your phone', details: legA.data },
        { status: legA.status }
      )
    }

    const legAControlId = legA.data?.data?.call_control_id
    if (!legAControlId) {
      return NextResponse.json(
        { error: 'Telnyx did not return a call_control_id for leg A' },
        { status: 502 }
      )
    }

    // Leg B — dial recipient, link to leg A so Telnyx auto-bridges on answer
    const legB = await originate({
      to: normalizedTo,
      from: normalizedFrom,
      connection_id: connectionId,
      link_to: legAControlId,
    })

    if (!legB.ok) {
      console.error('[calls/bridge] leg B failed:', legB.data)
      // Best-effort hang up of leg A so the user's phone doesn't keep ringing
      try {
        await fetch(`${TELNYX_API}/${legAControlId}/actions/hangup`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      } catch {}

      return NextResponse.json(
        { error: 'Failed to dial recipient', details: legB.data },
        { status: legB.status }
      )
    }

    return NextResponse.json({
      success: true,
      callbackCallControlId: legAControlId,
      recipientCallControlId: legB.data?.data?.call_control_id,
    })
  } catch (error) {
    console.error('[calls/bridge] error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
