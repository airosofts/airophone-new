import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Idempotent — if workspace already has a profile, return it
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, messaging_profile_id')
      .eq('id', workspaceId)
      .single()

    if (workspace?.messaging_profile_id) {
      return NextResponse.json({ success: true, messaging_profile_id: workspace.messaging_profile_id })
    }

    // Determine profile name: prefer businessName from request body, fallback to user name from DB
    let profileName = null
    try {
      const body = await request.json()
      if (body?.profileName?.trim()) profileName = body.profileName.trim()
    } catch {}

    if (!profileName) {
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', userId)
        .single()
      profileName = userData?.name || 'AiroPhone Workspace'
    }

    if (!TELNYX_API_KEY) {
      return NextResponse.json({ error: 'Telnyx API key not configured' }, { status: 500 })
    }

    // Create a dedicated Telnyx messaging profile for this workspace
    const telnyxRes = await fetch('https://api.telnyx.com/v2/messaging_profiles', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: profileName,
        whitelisted_destinations: ['US', 'CA'],
        webhook_url: `${SITE_URL}/api/webhooks/telnyx`,
        webhook_failover_url: `${SITE_URL}/api/webhooks/telnyx/failover`,
        webhook_api_version: '2',
        enabled: true,
      }),
    })

    if (!telnyxRes.ok) {
      const err = await telnyxRes.json().catch(() => ({}))
      console.error('[provision-messaging] Telnyx API error:', err)
      return NextResponse.json(
        { error: 'Failed to create messaging profile', details: err.errors || err.message },
        { status: 502 }
      )
    }

    const telnyxData = await telnyxRes.json()
    const messagingProfileId = telnyxData.data?.id

    if (!messagingProfileId) {
      return NextResponse.json({ error: 'Telnyx returned no profile ID' }, { status: 502 })
    }

    // Save to workspace
    await supabaseAdmin
      .from('workspaces')
      .update({
        messaging_profile_id: messagingProfileId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workspaceId)

    console.log(`[provision-messaging] Created profile ${messagingProfileId} for workspace ${workspaceId} (${profileName})`)

    return NextResponse.json({ success: true, messaging_profile_id: messagingProfileId })
  } catch (error) {
    console.error('[provision-messaging] Error:', error)
    return NextResponse.json({ error: 'Failed to provision messaging' }, { status: 500 })
  }
}
