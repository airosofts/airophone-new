import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

// A transient failure is a network-level problem (DNS, connect timeout, refused
// connection) — Supabase is briefly unreachable, not a real query bug. The
// notification bell polls often, so we degrade these to an empty 200 instead of
// a 500 so a blip doesn't surface as a UI error.
function isTransient(err) {
  const text = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.code || ''}`
  return /fetch failed|ConnectTimeout|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|UND_ERR/i.test(text)
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`fetch failed: timeout after ${ms}ms`)), ms)),
  ])
}

// Run the notifications query, retrying once on a transient network failure.
async function fetchNotifications(userId) {
  const run = () =>
    supabaseAdmin
      .from('notifications')
      .select(`
        *,
        actor:users!notifications_actor_fkey(id, name, profile_photo_url),
        conversation:conversations!notifications_conversation_fkey(id, phone_number, from_number, name),
        note:conversation_notes!notifications_note_fkey(id, content)
      `)
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await withTimeout(run(), 6000)
      if (error) throw error
      return data || []
    } catch (err) {
      lastErr = err
      // Only retry transient blips; a real query error won't fix itself.
      if (attempt === 0 && isTransient(err)) {
        await new Promise(r => setTimeout(r, 300))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

// GET - Fetch notifications for the current user
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let notifications
    try {
      notifications = await fetchNotifications(user.userId)
    } catch (err) {
      // Supabase briefly unreachable — return an empty, non-error payload so the
      // notification bell shows "nothing new" rather than breaking. `degraded`
      // lets the client tell this apart from a genuinely empty inbox.
      if (isTransient(err)) {
        console.warn('Notifications: Supabase unreachable, serving degraded response —', err?.message || err)
        return NextResponse.json({ success: true, notifications: [], unreadCount: 0, degraded: true })
      }
      console.error('Error fetching notifications:', err)
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
    }

    const unreadCount = notifications.filter(n => !n.is_read).length

    return NextResponse.json({
      success: true,
      notifications,
      unreadCount
    })
  } catch (error) {
    console.error('Error in notifications GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Mark notifications as read
export async function PUT(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { notificationIds, markAll } = await request.json()

    let query = supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', user.userId)

    if (!markAll && notificationIds?.length) {
      query = query.in('id', notificationIds)
    }

    const { error } = await query

    if (error) {
      console.error('Error marking notifications as read:', error)
      return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in notifications PUT:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
