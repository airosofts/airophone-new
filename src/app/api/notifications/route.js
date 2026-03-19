import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

// GET - Fetch notifications for the current user
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: notifications, error } = await supabaseAdmin
      .from('notifications')
      .select(`
        *,
        actor:users!notifications_actor_fkey(id, name, profile_photo_url),
        conversation:conversations!notifications_conversation_fkey(id, phone_number, from_number, name),
        note:conversation_notes!notifications_note_fkey(id, content)
      `)
      .eq('recipient_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error fetching notifications:', error)
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
    }

    const unreadCount = (notifications || []).filter(n => !n.is_read).length

    return NextResponse.json({
      success: true,
      notifications: notifications || [],
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
