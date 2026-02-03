import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request, { params }) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Await params to fix Next.js 15 async API issue
    const resolvedParams = await params
    const conversationId = resolvedParams.id

    const { data: notes, error } = await supabaseAdmin
      .from('conversation_notes')
      .select(`
        *,
        users!created_by(name)
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching notes:', error)
      return NextResponse.json(
        { error: 'Failed to fetch notes' },
        { status: 500 }
      )
    }

    // Format notes with creator name
    const formattedNotes = notes.map(note => ({
      ...note,
      created_by_name: note.users?.name || 'Team Member'
    }))

    return NextResponse.json({
      success: true,
      notes: formattedNotes
    })

  } catch (error) {
    console.error('Error in conversation notes API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}