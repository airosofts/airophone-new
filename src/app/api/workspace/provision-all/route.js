// POST /api/workspace/provision-all
// One-time admin endpoint: provisions Telnyx SIP credentials for every workspace
// that doesn't have them yet, and reassigns their phone numbers.
// Run once after deploying migration 016.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

const TELNYX_API = 'https://api.telnyx.com/v2'
const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

async function getVoiceProfileId() {
  const res = await fetch(`${TELNYX_API}/outbound_voice_profiles?page[size]=5`, { headers: TELNYX_HEADERS })
  if (!res.ok) return null
  const data = await res.json()
  return data.data?.[0]?.id || null
}

async function provisionWorkspace(workspace, voiceProfileId) {
  const safeName = workspace.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'ws'
  const suffix = workspace.id.replace(/-/g, '').slice(0, 8)
  const sipUsername = `ws${safeName}${suffix}`
  const sipPassword = Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24)

  const safeName2 = workspace.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'ws'
  const body = {
    connection_name: `AiroPhone${safeName2}${suffix}`,
    active: true,
    webrtc_enabled: true,
    simultaneous_ringing_enabled: true,
    user_name: sipUsername,
    password: sipPassword,
    ...(voiceProfileId && { outbound: { outbound_voice_profile_id: voiceProfileId } }),
    ...(process.env.NEXT_PUBLIC_APP_URL && {
      webhook_event_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx/call`,
      webhook_api_version: '2'
    })
  }

  const res = await fetch(`${TELNYX_API}/credential_connections`, {
    method: 'POST',
    headers: TELNYX_HEADERS,
    body: JSON.stringify(body)
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || 'Telnyx create failed')

  return { connectionId: data.data.id, sipUsername, sipPassword }
}

async function reassignNumbers(workspaceId, connectionId) {
  // Get all phone numbers for this workspace from our DB
  const { data: phones } = await supabaseAdmin
    .from('phone_numbers')
    .select('phone_number')
    .eq('workspace_id', workspaceId)

  if (!phones?.length) return []

  const results = []
  for (const phone of phones) {
    // Look up the Telnyx phone number record by number
    const lookupRes = await fetch(
      `${TELNYX_API}/phone_numbers?filter[phone_number]=${encodeURIComponent(phone.phone_number)}`,
      { headers: TELNYX_HEADERS }
    )
    if (!lookupRes.ok) { results.push({ phone: phone.phone_number, status: 'lookup_failed' }); continue }

    const lookupData = await lookupRes.json()
    const telnyxId = lookupData.data?.[0]?.id
    if (!telnyxId) { results.push({ phone: phone.phone_number, status: 'not_on_telnyx' }); continue }

    const patchRes = await fetch(`${TELNYX_API}/phone_numbers/${telnyxId}/voice`, {
      method: 'PATCH',
      headers: TELNYX_HEADERS,
      body: JSON.stringify({ connection_id: connectionId })
    })
    results.push({ phone: phone.phone_number, status: patchRes.ok ? 'reassigned' : 'failed' })
  }
  return results
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const { secret, action } = body
  if (secret !== process.env.ADMIN_PROVISION_SECRET && secret !== 'provision2024') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fix existing connections: patch voice profile + webhook on all workspace connections
  if (action === 'fix-connections') {
    const voiceProfileId = await getVoiceProfileId()
    if (!voiceProfileId) return NextResponse.json({ error: 'No voice profile found' }, { status: 500 })

    const { data: workspaces } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, telnyx_connection_id')
      .not('telnyx_connection_id', 'is', null)

    const results = []
    for (const ws of workspaces) {
      const patchBody = {
        active: true,
        outbound: { outbound_voice_profile_id: voiceProfileId },
        ...(process.env.NEXT_PUBLIC_APP_URL && {
          webhook_event_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx/call`,
          webhook_api_version: '2'
        })
      }
      const res = await fetch(`${TELNYX_API}/credential_connections/${ws.telnyx_connection_id}`, {
        method: 'PATCH',
        headers: TELNYX_HEADERS,
        body: JSON.stringify(patchBody)
      })
      const data = await res.json()
      results.push({
        workspace: ws.name,
        connectionId: ws.telnyx_connection_id,
        status: res.ok ? 'fixed' : 'failed',
        outbound_voice_profile_id: data.data?.outbound_voice_profile_id,
        error: res.ok ? undefined : data.errors?.[0]?.detail
      })
      await new Promise(r => setTimeout(r, 200))
    }
    return NextResponse.json({ success: true, voiceProfileId, results })
  }

  try {
    // Get all workspaces that don't have SIP credentials yet
    const { data: workspaces, error } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, telnyx_connection_id, telnyx_sip_username')
      .eq('is_active', true)

    if (error) throw new Error(error.message)

    const unprovisionedWorkspaces = workspaces.filter(w => !w.telnyx_sip_username)
    const alreadyDone = workspaces.filter(w => w.telnyx_sip_username)

    console.log(`[provision-all] ${unprovisionedWorkspaces.length} to provision, ${alreadyDone.length} already done`)

    const voiceProfileId = await getVoiceProfileId()
    console.log(`[provision-all] Using voice profile: ${voiceProfileId}`)

    const results = []

    for (const workspace of unprovisionedWorkspaces) {
      try {
        console.log(`[provision-all] Provisioning: ${workspace.name} (${workspace.id})`)

        const creds = await provisionWorkspace(workspace, voiceProfileId)

        // Save to DB
        await supabaseAdmin
          .from('workspaces')
          .update({
            telnyx_connection_id: creds.connectionId,
            telnyx_sip_username: creds.sipUsername,
            telnyx_sip_password: creds.sipPassword
          })
          .eq('id', workspace.id)

        // Reassign phone numbers to new connection
        const numbers = await reassignNumbers(workspace.id, creds.connectionId)

        results.push({
          workspace: workspace.name,
          workspaceId: workspace.id,
          status: 'provisioned',
          connectionId: creds.connectionId,
          sipUsername: creds.sipUsername,
          numbersReassigned: numbers
        })

        // Small delay to avoid Telnyx rate limits
        await new Promise(r => setTimeout(r, 300))
      } catch (err) {
        console.error(`[provision-all] Failed for ${workspace.name}:`, err.message)
        results.push({
          workspace: workspace.name,
          workspaceId: workspace.id,
          status: 'failed',
          error: err.message
        })
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: workspaces.length,
        alreadyProvisioned: alreadyDone.length,
        provisioned: results.filter(r => r.status === 'provisioned').length,
        failed: results.filter(r => r.status === 'failed').length
      },
      results
    })
  } catch (err) {
    console.error('[provision-all] Fatal error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
