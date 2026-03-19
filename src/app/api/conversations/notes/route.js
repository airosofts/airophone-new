import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { conversation_id, content, mentioned_users } = await request.json()

    if (!conversation_id || !content) {
      return NextResponse.json(
        { error: 'Conversation ID and content are required' },
        { status: 400 }
      )
    }

    const { data: note, error } = await supabaseAdmin
      .from('conversation_notes')
      .insert({
        conversation_id,
        content,
        created_by: user.userId,
        mentioned_users: mentioned_users || []
      })
      .select(`
        *,
        users!created_by(name)
      `)
      .single()

    if (error) {
      console.error('Error creating note:', error)
      return NextResponse.json(
        { error: 'Failed to create note' },
        { status: 500 }
      )
    }

    // Create notifications for mentioned users
    if (mentioned_users?.length > 0) {
      const notifications = mentioned_users
        .filter(id => id !== user.userId) // Don't notify yourself
        .map(recipientId => ({
          workspace_id: user.workspaceId,
          recipient_id: recipientId,
          actor_id: user.userId,
          type: 'mention',
          conversation_id,
          note_id: note.id,
          content: content.length > 120 ? content.slice(0, 120) + '...' : content
        }))

      if (notifications.length > 0) {
        const { error: notifError } = await supabaseAdmin
          .from('notifications')
          .insert(notifications)

        if (notifError) {
          console.error('Error creating notifications:', notifError)
          // Don't fail the note creation if notifications fail
        }
      }
    }

    // Format note with creator name
    const formattedNote = {
      ...note,
      created_by_name: note.users?.name || user.name
    }

    return NextResponse.json({
      success: true,
      note: formattedNote
    })

  } catch (error) {
    console.error('Error in create note API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
