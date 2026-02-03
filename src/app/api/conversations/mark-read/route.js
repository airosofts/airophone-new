import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const { conversationId, userId } = await request.json()

    if (!conversationId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Call the database function to mark messages as read
    const { data, error } = await supabaseAdmin.rpc('mark_messages_as_read', {
      p_conversation_id: conversationId,
      p_user_id: userId
    })

    if (error) {
      console.error('Error marking messages as read:', error)
      return NextResponse.json(
        { error: 'Failed to mark messages as read' },
        { status: 500 }
      )
    }

    // Get user name for logging
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('name')
      .eq('id', userId)
      .single()

    return NextResponse.json({
      success: true,
      markedCount: data,
      userName: userData?.name || 'Unknown User'
    })
  } catch (error) {
    console.error('Error in mark-read API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}