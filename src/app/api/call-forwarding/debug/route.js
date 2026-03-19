import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

// GET /api/call-forwarding/debug - Check forwarding setup status (no auth required for debugging)
export async function GET(request) {
  try {
    // Try to get user context but don't require it
    const user = getUserFromRequest(request)
    const workspaceId = user?.workspaceId || null

    const supabase = createSupabaseServerClient()
    const checks = {}

    // 1. Check if calls table exists
    const { count: callsCount, error: callsError } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true })

    checks.calls_table = callsError
      ? { status: 'ERROR', message: callsError.message, hint: callsError.hint }
      : { status: 'OK', total_rows: callsCount }

    // 2. Check if call_forwarding_rules table exists
    const { count: rulesCount, error: rulesError } = await supabase
      .from('call_forwarding_rules')
      .select('*', { count: 'exact', head: true })

    checks.forwarding_rules_table = rulesError
      ? { status: 'ERROR', message: rulesError.message, hint: rulesError.hint }
      : { status: 'OK', total_rows: rulesCount }

    // 3. Get active forwarding rules (workspace-scoped if logged in, otherwise all)
    let rulesQuery = supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number, custom_name)')
      .eq('is_active', true)
    if (workspaceId) rulesQuery = rulesQuery.eq('workspace_id', workspaceId)
    const { data: activeRules, error: activeError } = await rulesQuery

    checks.active_rules = activeError
      ? { status: 'ERROR', message: activeError.message }
      : {
          status: 'OK',
          count: activeRules?.length || 0,
          rules: activeRules?.map(r => ({
            id: r.id,
            phone_number_id: r.phone_number_id,
            phone_number: r.phone_numbers?.phone_number,
            custom_name: r.phone_numbers?.custom_name,
            forward_to: r.forward_to,
            is_active: r.is_active
          }))
        }

    // 4. Get phone numbers (workspace-scoped if logged in, otherwise all)
    let phoneQuery = supabase
      .from('phone_numbers')
      .select('id, phone_number, custom_name, workspace_id, is_active, connection_id')
    if (workspaceId) phoneQuery = phoneQuery.eq('workspace_id', workspaceId)
    const { data: phoneNumbers, error: phoneError } = await phoneQuery

    checks.phone_numbers = phoneError
      ? { status: 'ERROR', message: phoneError.message }
      : { status: 'OK', count: phoneNumbers?.length || 0, numbers: phoneNumbers }

    // 5. Get last 10 calls (ALL calls, not just this workspace — to catch missing workspace_id)
    const { data: recentCalls, error: recentError } = await supabase
      .from('calls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    checks.recent_calls = recentError
      ? { status: 'ERROR', message: recentError.message }
      : { status: 'OK', count: recentCalls?.length || 0, calls: recentCalls }

    // 6. Check Telnyx API key
    checks.telnyx_api_key = process.env.TELNYX_API_KEY
      ? { status: 'OK', prefix: process.env.TELNYX_API_KEY.substring(0, 10) + '...' }
      : { status: 'MISSING' }

    // 7. Telnyx connection info
    checks.telnyx_connection = {
      connection_id: process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID || 'NOT SET',
      sip_username: process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME || 'NOT SET',
      webrtc_domain: process.env.NEXT_PUBLIC_TELNYX_WEBRTC_DOMAIN || 'NOT SET'
    }

    // 8. Check webhook URL config
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'UNKNOWN'
    checks.webhook_config = {
      app_url: appUrl,
      call_webhook_url: `${appUrl}/api/webhooks/telnyx/call`,
      sms_webhook_url: `${appUrl}/api/webhooks/telnyx`,
      instructions: [
        '1. Go to Telnyx Portal > Networking > Connections',
        `2. Find the connection with ID: ${process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID || 'CHECK .env'}`,
        '3. Under "Inbound" settings, set the webhook URL to the call_webhook_url above',
        '4. Make sure "Receive call events" or "Webhook URL" is set for voice',
        '5. Also check: Telnyx Portal > Phone Numbers > your number > Voice Settings > Connection is set correctly'
      ]
    }

    // 9. Search across ALL Telnyx resource types to find connection and webhook config
    const connectionId = process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID
    const telnyxHeaders = {
      'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json'
    }

    checks.telnyx_search = {}

    try {
      // Try all connection types
      const endpoints = [
        { name: 'credential_connections', url: `https://api.telnyx.com/v2/credential_connections/${connectionId}` },
        { name: 'fqdn_connections', url: `https://api.telnyx.com/v2/fqdn_connections/${connectionId}` },
        { name: 'ip_connections', url: `https://api.telnyx.com/v2/ip_connections/${connectionId}` },
      ]

      for (const ep of endpoints) {
        try {
          const res = await fetch(ep.url, { headers: telnyxHeaders })
          const data = await res.json()
          checks.telnyx_search[ep.name] = res.ok ? { found: true, data: data.data } : { found: false }
        } catch (e) {
          checks.telnyx_search[ep.name] = { found: false, error: e.message }
        }
      }

      // List Call Control Applications — this is likely where the webhook is configured
      try {
        const appsRes = await fetch('https://api.telnyx.com/v2/call_control_applications?page[size]=25', {
          headers: telnyxHeaders
        })
        const appsData = await appsRes.json()
        if (appsRes.ok && appsData.data) {
          checks.call_control_applications = appsData.data.map(app => ({
            id: app.id,
            name: app.application_name,
            active: app.active,
            webhook_event_url: app.webhook_event_url || 'NOT SET',
            webhook_event_failover_url: app.webhook_event_failover_url || 'not set',
            inbound: app.inbound,
            outbound: app.outbound,
            FIX: !app.webhook_event_url
              ? `NEEDS webhook_event_url set to: ${appUrl}/api/webhooks/telnyx/call`
              : (app.webhook_event_url.includes('/api/webhooks/telnyx/call') ? 'LOOKS CORRECT' : `WRONG URL — should be: ${appUrl}/api/webhooks/telnyx/call`)
          }))
        } else {
          checks.call_control_applications = { error: appsData }
        }
      } catch (e) {
        checks.call_control_applications = { error: e.message }
      }

      // List TeXML Applications
      try {
        const texmlRes = await fetch('https://api.telnyx.com/v2/texml_applications?page[size]=25', {
          headers: telnyxHeaders
        })
        const texmlData = await texmlRes.json()
        if (texmlRes.ok && texmlData.data) {
          checks.texml_applications = texmlData.data.map(app => ({
            id: app.id,
            name: app.friendly_name,
            active: app.active,
            voice_url: app.voice_url || 'NOT SET',
            voice_method: app.voice_method,
            status_callback_url: app.status_callback_url || 'not set'
          }))
        } else {
          checks.texml_applications = { error: texmlData }
        }
      } catch (e) {
        checks.texml_applications = { error: e.message }
      }

      // Check phone number voice settings for the forwarding number
      if (activeRules?.length > 0) {
        const fwdPhone = activeRules[0].phone_numbers?.phone_number
        if (fwdPhone) {
          try {
            // List phone numbers from Telnyx to check their voice config
            const phoneRes = await fetch(
              `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(fwdPhone)}&page[size]=1`,
              { headers: telnyxHeaders }
            )
            const phoneData = await phoneRes.json()
            if (phoneRes.ok && phoneData.data?.[0]) {
              const pn = phoneData.data[0]
              checks.forwarding_phone_telnyx_config = {
                phone_number: pn.phone_number,
                connection_id: pn.connection_id || 'NOT SET — phone number has no voice connection!',
                connection_name: pn.connection_name,
                messaging_profile_id: pn.messaging_profile_id,
                status: pn.status,
                tags: pn.tags
              }

              // Also fetch the voice settings
              const voiceRes = await fetch(
                `https://api.telnyx.com/v2/phone_numbers/${pn.id}/voice`,
                { headers: telnyxHeaders }
              )
              const voiceData = await voiceRes.json()
              checks.forwarding_phone_voice_settings = voiceRes.ok
                ? voiceData.data
                : { error: voiceData, note: 'Voice not configured on this number' }
            } else {
              checks.forwarding_phone_telnyx_config = { error: phoneData, phone: fwdPhone }
            }
          } catch (e) {
            checks.forwarding_phone_telnyx_config = { error: e.message }
          }
        }
      }
    } catch (e) {
      checks.telnyx_search_error = e.message
    }

    return NextResponse.json({
      success: true,
      workspace_id: workspaceId || 'not logged in — showing all data',
      checks
    })
  } catch (error) {
    console.error('Debug endpoint error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/call-forwarding/debug - Simulate a webhook to test the full flow (no auth for debugging)
export async function POST(request) {
  try {
    const { to_number, from_number } = await request.json()

    if (!to_number) {
      return NextResponse.json({
        error: 'Provide to_number (your Telnyx line) and optionally from_number to simulate an inbound call'
      }, { status: 400 })
    }

    // Simulate what Telnyx sends as a call.initiated webhook
    const fakePayload = {
      data: {
        event_type: 'call.initiated',
        payload: {
          call_control_id: `test_${Date.now()}`,
          direction: 'incoming',
          from: from_number || '+15551234567',
          to: to_number,
          state: 'new'
        }
      }
    }

    // Call our own webhook handler internally
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhooks/telnyx/call`

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fakePayload)
    })

    const result = await res.json()

    // Check what happened in the DB
    const supabase = createSupabaseServerClient()
    const { data: testCall } = await supabase
      .from('calls')
      .select('*')
      .eq('telnyx_call_id', fakePayload.data.payload.call_control_id)
      .single()

    return NextResponse.json({
      success: true,
      test_call_id: fakePayload.data.payload.call_control_id,
      webhook_response: { status: res.status, body: result },
      db_record: testCall || 'NOT FOUND — webhook failed to insert',
      note: 'This was a simulated test. The Telnyx transfer API call will fail since there is no real call, but the DB insert and rule matching should work.'
    })
  } catch (error) {
    console.error('Debug test error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/call-forwarding/debug - Clean up all test/duplicate call records
export async function DELETE(request) {
  try {
    const supabase = createSupabaseServerClient()

    // Count before
    const { count: before } = await supabase.from('calls').select('*', { count: 'exact', head: true })

    // Delete all calls (clean slate for testing)
    const { error } = await supabase.from('calls').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      deleted: before,
      message: `Deleted ${before} call records. Ready for clean testing.`
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
