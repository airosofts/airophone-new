// GET /api/calls/debug-webrtc - Check WebRTC/SIP credential connection status
import { NextResponse } from 'next/server'

const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

export async function GET() {
  const results = {
    env: {
      connectionId: process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID || 'NOT SET',
      sipUsername: process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME || 'NOT SET',
      sipPasswordSet: !!process.env.NEXT_PUBLIC_TELNYX_SIP_PASSWORD,
    },
    connection: null,
    credentials: null,
    allConnections: []
  }

  try {
    // Check the specific connection ID - return FULL raw data
    const connId = process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID
    if (connId) {
      const res = await fetch(`https://api.telnyx.com/v2/credential_connections/${connId}`, {
        headers: TELNYX_HEADERS
      })
      if (res.ok) {
        const data = await res.json()
        results.connection = data.data // Return full raw object
      } else {
        const err = await res.json().catch(() => ({}))
        results.connection = { error: `${res.status} - ${err.errors?.[0]?.detail || res.statusText}` }
      }
    }

    // List all credential connections
    const listRes = await fetch('https://api.telnyx.com/v2/credential_connections?page[size]=20', {
      headers: TELNYX_HEADERS
    })
    if (listRes.ok) {
      const listData = await listRes.json()
      results.allConnections = (listData.data || []).map(c => ({
        id: c.id,
        name: c.connection_name,
        active: c.active,
        user_name: c.user_name,
        webrtc_enabled: c.webrtc_enabled,
        outbound_voice_profile_id: c.outbound_voice_profile_id
      }))
    }

    // List FQDN connections too (alternative WebRTC approach)
    const fqdnRes = await fetch('https://api.telnyx.com/v2/fqdn_connections?page[size]=20', {
      headers: TELNYX_HEADERS
    })
    if (fqdnRes.ok) {
      const fqdnData = await fqdnRes.json()
      results.fqdnConnections = (fqdnData.data || []).map(c => ({
        id: c.id,
        name: c.connection_name,
        active: c.active
      }))
    }

    // Check outbound voice profiles
    const profileRes = await fetch('https://api.telnyx.com/v2/outbound_voice_profiles?page[size]=10', {
      headers: TELNYX_HEADERS
    })
    if (profileRes.ok) {
      const profileData = await profileRes.json()
      results.voiceProfiles = (profileData.data || []).map(p => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled
      }))
    }

    // Check phone number connection assignments
    const phoneRes = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=20', {
      headers: TELNYX_HEADERS
    })
    if (phoneRes.ok) {
      const phoneData = await phoneRes.json()
      results.phoneNumbers = (phoneData.data || []).map(p => ({
        id: p.id,
        phone_number: p.phone_number,
        connection_id: p.connection_id,
        connection_name: p.connection_name,
        status: p.status
      }))
    }
  } catch (error) {
    results.error = error.message
  }

  return NextResponse.json(results)
}

// POST /api/calls/debug-webrtc - Create or fix credential connection
export async function POST(request) {
  try {
    const { action } = await request.json()

    if (action === 'create') {
      // Create a new credential connection for WebRTC
      const res = await fetch('https://api.telnyx.com/v2/credential_connections', {
        method: 'POST',
        headers: TELNYX_HEADERS,
        body: JSON.stringify({
          connection_name: 'AiroPhone WebRTC',
          active: true,
          webrtc_enabled: true,
          user_name: process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME,
          password: process.env.NEXT_PUBLIC_TELNYX_SIP_PASSWORD
        })
      })

      const data = await res.json()
      if (!res.ok) {
        return NextResponse.json({ error: data.errors?.[0]?.detail || 'Failed to create', details: data }, { status: 400 })
      }

      return NextResponse.json({
        success: true,
        message: 'Credential connection created. Update NEXT_PUBLIC_TELNYX_CONNECTION_ID in your .env',
        connection: {
          id: data.data?.id,
          name: data.data?.connection_name,
          user_name: data.data?.user_name,
          active: data.data?.active,
          webrtc_enabled: data.data?.webrtc_enabled
        }
      })
    }

    if (action === 'fix') {
      // First, find the outbound voice profile
      let voiceProfileId = null
      const profileRes = await fetch('https://api.telnyx.com/v2/outbound_voice_profiles?page[size]=5', {
        headers: TELNYX_HEADERS
      })
      if (profileRes.ok) {
        const profileData = await profileRes.json()
        voiceProfileId = profileData.data?.[0]?.id || null
      }

      // Enable WebRTC on existing connection + attach voice profile
      const connId = process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID
      if (!connId) {
        return NextResponse.json({ error: 'No connection ID in env' }, { status: 400 })
      }

      const patchBody = {
        active: true,
        webrtc_enabled: true,
        user_name: process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME,
        password: process.env.NEXT_PUBLIC_TELNYX_SIP_PASSWORD
      }
      if (voiceProfileId) {
        patchBody.outbound_voice_profile_id = voiceProfileId
      }

      const res = await fetch(`https://api.telnyx.com/v2/credential_connections/${connId}`, {
        method: 'PATCH',
        headers: TELNYX_HEADERS,
        body: JSON.stringify(patchBody)
      })

      const data = await res.json()
      if (!res.ok) {
        return NextResponse.json({ error: data.errors?.[0]?.detail || 'Failed to update', details: data }, { status: 400 })
      }

      return NextResponse.json({
        success: true,
        message: 'Credential connection updated',
        connection: {
          id: data.data?.id,
          active: data.data?.active,
          webrtc_enabled: data.data?.webrtc_enabled,
          user_name: data.data?.user_name
        }
      })
    }

    if (action === 'assign-numbers') {
      // Reassign all phone numbers to the current credential connection
      const connId = process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID
      if (!connId) {
        return NextResponse.json({ error: 'No connection ID in env' }, { status: 400 })
      }

      const phoneRes = await fetch('https://api.telnyx.com/v2/phone_numbers?page[size]=20', {
        headers: TELNYX_HEADERS
      })
      if (!phoneRes.ok) {
        return NextResponse.json({ error: 'Failed to list phone numbers' }, { status: 500 })
      }

      const phoneData = await phoneRes.json()
      const results = []

      for (const phone of (phoneData.data || [])) {
        if (phone.connection_id === connId) {
          results.push({ phone: phone.phone_number, status: 'already_assigned' })
          continue
        }

        const patchRes = await fetch(`https://api.telnyx.com/v2/phone_numbers/${phone.id}/voice`, {
          method: 'PATCH',
          headers: TELNYX_HEADERS,
          body: JSON.stringify({ connection_id: connId })
        })

        if (patchRes.ok) {
          results.push({ phone: phone.phone_number, status: 'reassigned', from: phone.connection_id })
        } else {
          const err = await patchRes.json().catch(() => ({}))
          results.push({ phone: phone.phone_number, status: 'failed', error: err.errors?.[0]?.detail })
        }
      }

      return NextResponse.json({ success: true, connectionId: connId, results })
    }

    return NextResponse.json({ error: 'Unknown action. Use "create", "fix", or "assign-numbers"' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
