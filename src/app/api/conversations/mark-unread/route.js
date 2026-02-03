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

    // Call the database function to mark as unread
    const { data, error } = await supabaseAdmin.rpc('mark_conversation_unread', {
      p_conversation_id: conversationId,
      p_user_id: userId
    })

    if (error) {
      console.error('Error marking conversation as unread:', error)
      return NextResponse.json(
        { error: 'Failed to mark conversation as unread' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      updatedCount: data
    })
  } catch (error) {
    console.error('Error in mark-unread API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}