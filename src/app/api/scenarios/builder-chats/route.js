// Builder chat history (ChatGPT-style).
//   GET  /api/scenarios/builder-chats          → list for the workspace
//   POST /api/scenarios/builder-chats { title } → create a chat

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('scenario_builder_chats')
    .select('id, title, scenario_id, updated_at, created_at')
    .eq('workspace_id', user.workspaceId)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[builder-chats GET] db error:', error)
    return NextResponse.json({ error: 'Failed to load chats' }, { status: 500 })
  }
  return NextResponse.json({ chats: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { data, error } = await supabaseAdmin
    .from('scenario_builder_chats')
    .insert({
      workspace_id: user.workspaceId,
      title: (body.title || 'New scenario chat').slice(0, 120),
      draft: body.draft || null,
      created_by: user.userId || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[builder-chats POST] db error:', error)
    return NextResponse.json({ error: 'Failed to create chat' }, { status: 500 })
  }
  return NextResponse.json({ success: true, chat: data })
}
