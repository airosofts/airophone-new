import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// POST /api/conversations/ai-toggle
// Body: { conversationId, paused: true|false }
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { conversationId, paused } = await request.json()

    if (!conversationId || typeof paused !== 'boolean') {
      return NextResponse.json({ error: 'conversationId and paused (boolean) are required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('conversations')
      .update({ manual_override: paused })
      .eq('id', conversationId)

    if (error) {
      console.error('Error toggling AI:', error)
      return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
    }

    return NextResponse.json({ success: true, paused })

  } catch (error) {
    console.error('Error in ai-toggle:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
