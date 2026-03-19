import { NextResponse } from 'next/server'

const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ap.airosofts.com'
const WEBHOOK_URL = `${APP_URL}/api/webhooks/telnyx/call`

// POST /api/call-forwarding/setup-webhook
// Finds the connection attached to your phone numbers and sets the webhook URL
export async function POST(request) {
  const logs = []
  const log = (msg) => logs.push(msg)

  try {
    log(`Target webhook URL: ${WEBHOOK_URL}`)

    // Step 1: Find all unique connection IDs from our phone numbers
    const phoneRes = await fetch(
      'https://api.telnyx.com/v2/phone_numbers?page[size]=50',
      { headers: TELNYX_HEADERS }
    )
    const phoneData = await phoneRes.json()

    if (!phoneRes.ok) {
      return NextResponse.json({ error: 'Failed to list phone numbers from Telnyx', details: phoneData }, { status: 500 })
    }

    const connectionIds = [...new Set(
      phoneData.data
        .filter(p => p.connection_id)
        .map(p => ({ connection_id: p.connection_id, connection_name: p.connection_name, phone: p.phone_number }))
    )]

    log(`Found ${connectionIds.length} connections across phone numbers`)
    log(`Connections: ${JSON.stringify(connectionIds)}`)

    if (connectionIds.length === 0) {
      return NextResponse.json({
        error: 'No phone numbers have a voice connection assigned in Telnyx',
        fix: 'Go to Telnyx Portal > Phone Numbers > select a number > Voice Settings > assign a Connection',
        logs
      }, { status: 400 })
    }

    // Step 2: For each connection, try to find it and update webhook
    const results = []
    const uniqueConnIds = [...new Set(connectionIds.map(c => c.connection_id))]

    for (const connId of uniqueConnIds) {
      log(`\nProcessing connection: ${connId}`)

      // Try credential connection
      let found = false
      for (const type of ['credential_connections', 'fqdn_connections', 'ip_connections']) {
        const res = await fetch(`https://api.telnyx.com/v2/${type}/${connId}`, { headers: TELNYX_HEADERS })
        if (res.ok) {
          const data = await res.json()
          const conn = data.data
          log(`Found as ${type}: "${conn.connection_name || conn.active}"`)
          log(`Current webhook_event_url: ${conn.webhook_event_url || 'NOT SET'}`)

          // Update webhook URL
          const updateRes = await fetch(`https://api.telnyx.com/v2/${type}/${connId}`, {
            method: 'PATCH',
            headers: TELNYX_HEADERS,
            body: JSON.stringify({
              webhook_event_url: WEBHOOK_URL
            })
          })
          const updateData = await updateRes.json()

          if (updateRes.ok) {
            log(`UPDATED webhook_event_url to: ${WEBHOOK_URL}`)
            results.push({
              connection_id: connId,
              type,
              name: conn.connection_name,
              status: 'UPDATED',
              webhook_event_url: WEBHOOK_URL
            })
          } else {
            log(`Failed to update: ${JSON.stringify(updateData)}`)
            results.push({
              connection_id: connId,
              type,
              status: 'UPDATE_FAILED',
              error: updateData
            })
          }

          found = true
          break
        }
      }

      if (!found) {
        log(`Connection ${connId} not found in credential/fqdn/ip types`)

        // It might be linked to a Call Control App — try to find it
        const appsRes = await fetch('https://api.telnyx.com/v2/call_control_applications?page[size]=50', {
          headers: TELNYX_HEADERS
        })
        const appsData = await appsRes.json()

        if (appsRes.ok && appsData.data) {
          for (const app of appsData.data) {
            log(`Checking Call Control App: "${app.application_name}" (${app.id})`)
            // Update all call control apps to use our webhook
            const updateRes = await fetch(`https://api.telnyx.com/v2/call_control_applications/${app.id}`, {
              method: 'PATCH',
              headers: TELNYX_HEADERS,
              body: JSON.stringify({
                webhook_event_url: WEBHOOK_URL
              })
            })
            const updateData = await updateRes.json()

            if (updateRes.ok) {
              log(`UPDATED Call Control App "${app.application_name}" webhook to: ${WEBHOOK_URL}`)
              results.push({
                type: 'call_control_application',
                id: app.id,
                name: app.application_name,
                status: 'UPDATED',
                webhook_event_url: WEBHOOK_URL
              })
            } else {
              log(`Failed to update app: ${JSON.stringify(updateData)}`)
            }
          }
        }

        // Also try updating the credential connection that WebRTC uses
        const webrtcConnId = process.env.NEXT_PUBLIC_TELNYX_CONNECTION_ID
        if (webrtcConnId && webrtcConnId !== connId) {
          log(`Also trying WebRTC connection: ${webrtcConnId}`)
          for (const type of ['credential_connections', 'fqdn_connections']) {
            const res = await fetch(`https://api.telnyx.com/v2/${type}/${webrtcConnId}`, { headers: TELNYX_HEADERS })
            if (res.ok) {
              const updateRes = await fetch(`https://api.telnyx.com/v2/${type}/${webrtcConnId}`, {
                method: 'PATCH',
                headers: TELNYX_HEADERS,
                body: JSON.stringify({ webhook_event_url: WEBHOOK_URL })
              })
              if (updateRes.ok) {
                log(`UPDATED WebRTC connection webhook to: ${WEBHOOK_URL}`)
                results.push({
                  connection_id: webrtcConnId,
                  type,
                  status: 'UPDATED (WebRTC)',
                  webhook_event_url: WEBHOOK_URL
                })
              }
              break
            }
          }
        }

        if (results.length === 0) {
          // Last resort: try direct PATCH on the connection ID
          log(`Trying direct PATCH on connection ${connId} as generic connection...`)
          for (const type of ['credential_connections', 'fqdn_connections', 'ip_connections']) {
            try {
              const updateRes = await fetch(`https://api.telnyx.com/v2/${type}`, {
                method: 'GET',
                headers: TELNYX_HEADERS
              })
              const listData = await updateRes.json()
              if (updateRes.ok && listData.data) {
                log(`Listed ${listData.data.length} ${type}`)
                for (const conn of listData.data) {
                  log(`  - ${conn.id}: "${conn.connection_name}" webhook: ${conn.webhook_event_url || 'NOT SET'}`)
                  // Update this connection's webhook
                  const patchRes = await fetch(`https://api.telnyx.com/v2/${type}/${conn.id}`, {
                    method: 'PATCH',
                    headers: TELNYX_HEADERS,
                    body: JSON.stringify({ webhook_event_url: WEBHOOK_URL })
                  })
                  if (patchRes.ok) {
                    log(`  UPDATED "${conn.connection_name}" webhook to: ${WEBHOOK_URL}`)
                    results.push({
                      connection_id: conn.id,
                      type,
                      name: conn.connection_name,
                      status: 'UPDATED',
                      webhook_event_url: WEBHOOK_URL
                    })
                  }
                }
              }
            } catch (e) {
              log(`Error listing ${type}: ${e.message}`)
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      webhook_url: WEBHOOK_URL,
      results,
      logs,
      next_step: results.length > 0
        ? 'Webhook URL has been set! Try calling your number now and check /api/call-forwarding/debug to see if calls appear.'
        : 'Could not find the connection to update. You need to set the webhook URL manually in Telnyx Portal.'
    })

  } catch (error) {
    log(`FATAL: ${error.message}`)
    return NextResponse.json({ error: error.message, logs }, { status: 500 })
  }
}
