// POST /api/settings/enable-recording
// Configures the workspace's Telnyx credential connection to:
//   1. Send call events (call.initiated, call.answered, call.hangup,
//      call.recording.saved) to our webhook endpoint
//   2. Automatically start recording on every answered call
// This replaces having to configure anything in the Telnyx dashboard.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const TELNYX_API = 'https://api.telnyx.com/v2'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.TELNYX_API_KEY) {
    return NextResponse.json({ error: 'TELNYX_API_KEY not configured' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'
  const webhookUrl = `${appUrl}/api/webhooks/telnyx/call`

  // Get the workspace's Telnyx connection ID
  const { data: ws, error: wsErr } = await supabaseAdmin
    .from('workspaces')
    .select('id, name, telnyx_connection_id')
    .eq('id', workspace.workspaceId)
    .single()

  if (wsErr || !ws) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (!ws.telnyx_connection_id) {
    return NextResponse.json({ error: 'No Telnyx connection found for this workspace. Complete phone number setup first.' }, { status: 400 })
  }

  const headers = {
    'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
    'Content-Type': 'application/json',
  }

  // Credential connections (SIP/WebRTC) record via the connection-level
  // "Call Recording" setting — NOT the Call Control record_start action.
  // The fields live under nested inbound/outbound objects.
  const recordingConfig = {
    webhook_event_url: webhookUrl,
    webhook_api_version: '2',
    inbound: {
      channels: 'dual',
    },
    // Connection-level recording (applies to both inbound and outbound legs)
    record_type: 'all',          // record every call
    record_format: 'mp3',
    record_channels: 'dual',
  }

  const patchRes = await fetch(`${TELNYX_API}/credential_connections/${ws.telnyx_connection_id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(recordingConfig),
  })

  const patchData = await patchRes.json().catch(() => ({}))

  // Log the FULL response so we can see exactly which recording fields Telnyx accepted
  console.log('[enable-recording] PATCH status:', patchRes.status)
  console.log('[enable-recording] PATCH response:', JSON.stringify(patchData.data || patchData))

  if (!patchRes.ok) {
    const detail = patchData.errors?.[0]?.detail || patchData.error?.detail || JSON.stringify(patchData)
    console.error('[enable-recording] Telnyx PATCH failed:', patchRes.status, detail)
    return NextResponse.json({ error: `Telnyx error: ${detail}`, telnyxBody: patchData }, { status: 502 })
  }

  return NextResponse.json({
    success: true,
    connectionId: ws.telnyx_connection_id,
    webhookUrl,
    appliedConfig: patchData.data,
    message: 'Recording config applied. Check the returned appliedConfig to confirm which fields took effect.',
  })
}

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: ws } = await supabaseAdmin
    .from('workspaces')
    .select('telnyx_connection_id')
    .eq('id', workspace.workspaceId)
    .single()

  if (!ws?.telnyx_connection_id || !process.env.TELNYX_API_KEY) {
    return NextResponse.json({ configured: false })
  }

  const res = await fetch(`${TELNYX_API}/credential_connections/${ws.telnyx_connection_id}`, {
    headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}` },
  })

  const data = await res.json().catch(() => ({}))
  const conn = data.data || {}

  // Dump the full connection object so we can see exactly what recording fields exist
  console.log('[enable-recording:GET] full connection object:', JSON.stringify(conn))

  return NextResponse.json({
    configured: res.ok,
    connectionId: ws.telnyx_connection_id,
    connectionType: conn.connection_type || conn.record_type,
    webhookUrl: conn.webhook_event_url,
    recordType: conn.record_type,
    recordFormat: conn.record_format,
    recordChannels: conn.record_channels,
    webhookVersion: conn.webhook_api_version,
    rawConnection: conn,   // full object for inspection
  })
}
