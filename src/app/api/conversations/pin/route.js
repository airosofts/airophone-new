import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const { conversationId, pinned } = await request.json()

    if (!conversationId || typeof pinned !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Update conversation pinned status
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update({
        pinned: pinned,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .select()
      .single()

    if (error) {
      console.error('Error pinning conversation:', error)
      return NextResponse.json(
        { error: 'Failed to pin conversation' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      conversation: data
    })
  } catch (error) {
    console.error('Error in pin API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}