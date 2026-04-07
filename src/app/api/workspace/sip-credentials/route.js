// GET  /api/workspace/sip-credentials  — returns (or auto-provisions) SIP creds for current workspace
// POST /api/workspace/sip-credentials  — force re-provision (admin use)
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

const TELNYX_API = 'https://api.telnyx.com/v2'
const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

// Fetch the shared outbound voice profile ID (one profile covers all connections)
async function getVoiceProfileId() {
  const res = await fetch(`${TELNYX_API}/outbound_voice_profiles?page[size]=5`, { headers: TELNYX_HEADERS })
  if (!res.ok) return null
  const data = await res.json()
  return data.data?.[0]?.id || null
}

// Create a new Telnyx credential connection + SIP username/password for a workspace
async function provisionTelnyxCredential(workspaceId, workspaceName) {
  // Generate a unique SIP username and a strong random password
  const safeName = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'ws'
  const suffix = workspaceId.replace(/-/g, '').slice(0, 8)
  const sipUsername = `ws${safeName}${suffix}`
  const sipPassword = Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24)

  const voiceProfileId = await getVoiceProfileId()

  const body = {
    connection_name: `AiroPhone${workspaceName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}${suffix}`,
    active: true,
    webrtc_enabled: true,
    simultaneous_ringing_enabled: true,
    user_name: sipUsername,
    password: sipPassword,
    ...(voiceProfileId && { outbound_voice_profile_id: voiceProfileId })
  }

  // Add webhook URL if configured
  if (process.env.NEXT_PUBLIC_APP_URL) {
    body.webhook_event_url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx/call`
    body.webhook_event_failover_url = ''
    body.webhook_api_version = '2'
  }

  const res = await fetch(`${TELNYX_API}/credential_connections`, {
    method: 'POST',
    headers: TELNYX_HEADERS,
    body: JSON.stringify(body)
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.errors?.[0]?.detail || 'Failed to create Telnyx credential connection')
  }

  return {
    connectionId: data.data.id,
    sipUsername,
    sipPassword
  }
}

// Reassign all phone numbers belonging to this workspace to the new connection
async function reassignPhoneNumbers(workspaceId, connectionId) {
  const { data: phones } = await supabaseAdmin
    .from('phone_numbers')
    .select('phone_number, telnyx_phone_number_id')
    .eq('workspace_id', workspaceId)

  if (!phones?.length) return []

  const results = []
  for (const phone of phones) {
    if (!phone.telnyx_phone_number_id) {
      results.push({ phone: phone.phone_number, status: 'skipped_no_id' })
      continue
    }

    // Get the Telnyx phone number record ID first
    const listRes = await fetch(
      `${TELNYX_API}/phone_numbers?filter[phone_number]=${encodeURIComponent(phone.phone_number)}`,
      { headers: TELNYX_HEADERS }
    )
    if (!listRes.ok) {
      results.push({ phone: phone.phone_number, status: 'lookup_failed' })
      continue
    }
    const listData = await listRes.json()
    const telnyxId = listData.data?.[0]?.id
    if (!telnyxId) {
      results.push({ phone: phone.phone_number, status: 'not_found_on_telnyx' })
      continue
    }

    const patchRes = await fetch(`${TELNYX_API}/phone_numbers/${telnyxId}/voice`, {
      method: 'PATCH',
      headers: TELNYX_HEADERS,
      body: JSON.stringify({ connection_id: connectionId })
    })

    results.push({
      phone: phone.phone_number,
      status: patchRes.ok ? 'reassigned' : 'failed'
    })
  }
  return results
}

export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspaceId = user?.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace context' }, { status: 401 })
    }

    // Check if workspace already has SIP credentials
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, telnyx_connection_id, telnyx_sip_username, telnyx_sip_password')
      .eq('id', workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Already provisioned — return creds
    if (workspace.telnyx_connection_id && workspace.telnyx_sip_username && workspace.telnyx_sip_password) {
      return NextResponse.json({
        success: true,
        connectionId: workspace.telnyx_connection_id,
        sipUsername: workspace.telnyx_sip_username,
        sipPassword: workspace.telnyx_sip_password
      })
    }

    // Not provisioned yet — auto-provision now
    console.log(`[sip-credentials] Provisioning Telnyx credential for workspace: ${workspace.name}`)
    const creds = await provisionTelnyxCredential(workspaceId, workspace.name)

    // Save to DB
    await supabaseAdmin
      .from('workspaces')
      .update({
        telnyx_connection_id: creds.connectionId,
        telnyx_sip_username: creds.sipUsername,
        telnyx_sip_password: creds.sipPassword
      })
      .eq('id', workspaceId)

    // Reassign this workspace's phone numbers to the new connection
    const reassigned = await reassignPhoneNumbers(workspaceId, creds.connectionId)
    console.log(`[sip-credentials] Reassigned numbers:`, reassigned)

    return NextResponse.json({
      success: true,
      connectionId: creds.connectionId,
      sipUsername: creds.sipUsername,
      sipPassword: creds.sipPassword,
      provisioned: true,
      numbersReassigned: reassigned
    })
  } catch (err) {
    console.error('[sip-credentials] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Force re-provision (useful if connection was deleted on Telnyx side)
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspaceId = user?.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace context' }, { status: 401 })
    }

    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, telnyx_connection_id')
      .eq('id', workspaceId)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Delete old connection on Telnyx if it exists
    if (workspace.telnyx_connection_id) {
      await fetch(`${TELNYX_API}/credential_connections/${workspace.telnyx_connection_id}`, {
        method: 'DELETE',
        headers: TELNYX_HEADERS
      }).catch(() => {}) // ignore if already deleted
    }

    const creds = await provisionTelnyxCredential(workspaceId, workspace.name)

    await supabaseAdmin
      .from('workspaces')
      .update({
        telnyx_connection_id: creds.connectionId,
        telnyx_sip_username: creds.sipUsername,
        telnyx_sip_password: creds.sipPassword
      })
      .eq('id', workspaceId)

    const reassigned = await reassignPhoneNumbers(workspaceId, creds.connectionId)

    return NextResponse.json({
      success: true,
      connectionId: creds.connectionId,
      sipUsername: creds.sipUsername,
      numbersReassigned: reassigned
    })
  } catch (err) {
    console.error('[sip-credentials] Re-provision error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
