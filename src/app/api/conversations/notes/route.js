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