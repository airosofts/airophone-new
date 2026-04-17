// POST /api/push/subscribe  — saves a browser push subscription for this user/workspace
// DELETE /api/push/subscribe — removes the subscription (on logout/unsub)
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user?.userId || !user?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sub = await request.json()
    if (!sub?.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 })
    }

    // Upsert by endpoint (unique per browser profile)
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        user_id: user.userId,
        workspace_id: user.workspaceId,
        endpoint: sub.endpoint,
        p256dh: sub.keys?.p256dh,
        auth: sub.keys?.auth,
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' })

    if (error) {
      console.error('[push/subscribe] DB error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log('[push/subscribe] Saved subscription for workspace:', user.workspaceId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[push/subscribe] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { endpoint } = await request.json()
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
    }

    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', user.userId)

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
