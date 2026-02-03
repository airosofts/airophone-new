import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const { conversationId, status } = await request.json()

    if (!conversationId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate status
    const validStatuses = ['open', 'closed', 'done', 'archived']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      )
    }

    // Update conversation status
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update({
        status: status,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .select()
      .single()

    if (error) {
      console.error('Error updating conversation status:', error)
      return NextResponse.json(
        { error: 'Failed to update conversation status' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      conversation: data
    })
  } catch (error) {
    console.error('Error in update-status API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}