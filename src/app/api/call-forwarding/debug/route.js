import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

// GET /api/call-forwarding/debug - Check forwarding setup status
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    // 3. Get active forwarding rules for this workspace
    const { data: activeRules, error: activeError } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number, custom_name)')
      .eq('workspace_id', user.workspaceId)
      .eq('is_active', true)

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

    // 4. Get workspace phone numbers
    const { data: phoneNumbers, error: phoneError } = await supabase
      .from('phone_numbers')
      .select('id, phone_number, custom_name, workspace_id, is_active, connection_id')
      .eq('workspace_id', user.workspaceId)

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

    // 9. Try to fetch Telnyx connection details from API to check webhook config
    try {
      const connectionId = process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID
      if (connectionId) {
        const telnyxRes = await fetch(
          `https://api.telnyx.com/v2/credential_connections/${connectionId}`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        )
        const telnyxData = await telnyxRes.json()

        if (telnyxRes.ok && telnyxData.data) {
          const conn = telnyxData.data
          checks.telnyx_connection_details = {
            status: 'OK',
            name: conn.connection_name,
            active: conn.active,
            webhook_event_url: conn.webhook_event_url || 'NOT SET — THIS IS THE PROBLEM!',
            webhook_event_failover_url: conn.webhook_event_failover_url || 'not set',
            inbound_settings: conn.inbound || 'not available',
            outbound_settings: conn.outbound || 'not available'
          }

          if (!conn.webhook_event_url) {
            checks.telnyx_connection_details.FIX = `Set webhook_event_url to: ${appUrl}/api/webhooks/telnyx/call`
          }
        } else {
          // Try FQDN connection type
          const fqdnRes = await fetch(
            `https://api.telnyx.com/v2/fqdn_connections/${connectionId}`,
            {
              headers: {
                'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          )
          const fqdnData = await fqdnRes.json()

          if (fqdnRes.ok && fqdnData.data) {
            checks.telnyx_connection_details = {
              status: 'OK (FQDN)',
              data: fqdnData.data
            }
          } else {
            checks.telnyx_connection_details = {
              status: 'COULD_NOT_FETCH',
              credential_error: telnyxData,
              fqdn_error: fqdnData
            }
          }
        }
      }
    } catch (e) {
      checks.telnyx_connection_details = {
        status: 'FETCH_ERROR',
        message: e.message
      }
    }

    return NextResponse.json({
      success: true,
      workspace_id: user.workspaceId,
      checks
    })
  } catch (error) {
    console.error('Debug endpoint error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/call-forwarding/debug - Simulate a webhook to test the full flow
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
