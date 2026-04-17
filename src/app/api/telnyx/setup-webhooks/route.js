// POST /api/telnyx/setup-webhooks
// Configures the messaging profile webhook URL in Telnyx so inbound SMS replies are delivered.
// Inbound SMS goes to the PROFILE webhook URL — the per-message webhook_url is delivery-report only.
import { NextResponse } from 'next/server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import { supabaseAdmin } from '@/lib/supabase-server'

const TELNYX_API = 'https://api.telnyx.com/v2'
const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

export async function POST(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const appUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SITE_URL not configured' }, { status: 500 })
    }

    const webhookUrl = `${appUrl}/api/webhooks/telnyx`
    const results = []

    // 1. Update workspace messaging profile webhook URL
    const messagingProfileId = workspace.messagingProfileId

    if (messagingProfileId) {
      const res = await fetch(`${TELNYX_API}/messaging_profiles/${messagingProfileId}`, {
        method: 'PATCH',
        headers: TELNYX_HEADERS,
        body: JSON.stringify({
          webhook_url: webhookUrl,
          webhook_api_version: '2'
        })
      })
      const data = await res.json()
      results.push({
        type: 'messaging_profile',
        id: messagingProfileId,
        status: res.ok ? 'updated' : 'failed',
        detail: res.ok ? webhookUrl : (data.errors?.[0]?.detail || 'unknown error')
      })
    }

    // 2. Also update all messaging profiles associated with this workspace's phone numbers
    const { data: phones } = await supabaseAdmin
      .from('phone_numbers')
      .select('phone_number, messaging_profile_id')
      .eq('workspace_id', workspace.workspaceId)

    if (phones?.length) {
      const profileIds = [...new Set(phones.map(p => p.messaging_profile_id).filter(Boolean))]

      for (const profileId of profileIds) {
        if (profileId === messagingProfileId) continue // already done above

        const res = await fetch(`${TELNYX_API}/messaging_profiles/${profileId}`, {
          method: 'PATCH',
          headers: TELNYX_HEADERS,
          body: JSON.stringify({
            webhook_url: webhookUrl,
            webhook_api_version: '2'
          })
        })
        const data = await res.json()
        results.push({
          type: 'messaging_profile',
          id: profileId,
          status: res.ok ? 'updated' : 'failed',
          detail: res.ok ? webhookUrl : (data.errors?.[0]?.detail || 'unknown error')
        })
      }
    }

    // 3. Fallback: update shared TELNYX_PROFILE_ID if set
    const sharedProfileId = process.env.TELNYX_PROFILE_ID
    if (sharedProfileId && sharedProfileId !== messagingProfileId) {
      const res = await fetch(`${TELNYX_API}/messaging_profiles/${sharedProfileId}`, {
        method: 'PATCH',
        headers: TELNYX_HEADERS,
        body: JSON.stringify({
          webhook_url: webhookUrl,
          webhook_api_version: '2'
        })
      })
      const data = await res.json()
      results.push({
        type: 'shared_profile',
        id: sharedProfileId,
        status: res.ok ? 'updated' : 'failed',
        detail: res.ok ? webhookUrl : (data.errors?.[0]?.detail || 'unknown error')
      })
    }

    const anySuccess = results.some(r => r.status === 'updated')
    return NextResponse.json({
      success: anySuccess,
      webhookUrl,
      results
    })
  } catch (error) {
    console.error('[setup-webhooks] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
