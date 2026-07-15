// One builder chat.
//   GET    → { chat, messages } (full transcript for reopening)
//   PATCH  → update { title?, draft?, scenario_id? }
//   DELETE → remove the chat (+ messages via cascade)

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

async function loadOwned(chatId, workspaceId) {
  const { data } = await supabaseAdmin
    .from('scenario_builder_chats')
    .select('*')
    .eq('id', chatId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data
}

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params

  const chat = await loadOwned(chatId, user.workspaceId)
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const { data: messages } = await supabaseAdmin
    .from('scenario_builder_messages')
    .select('role, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })

  return NextResponse.json({ chat, messages: messages || [] })
}

export async function PATCH(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params

  const chat = await loadOwned(chatId, user.workspaceId)
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const update = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string' && body.title.trim()) update.title = body.title.trim().slice(0, 120)
  if (body.draft !== undefined) update.draft = body.draft
  if (body.scenario_id !== undefined) update.scenario_id = body.scenario_id || null

  const { data, error } = await supabaseAdmin
    .from('scenario_builder_chats')
    .update(update)
    .eq('id', chatId)
    .select()
    .single()

  if (error) {
    console.error('[builder-chat PATCH] db error:', error)
    return NextResponse.json({ error: 'Failed to update chat' }, { status: 500 })
  }
  return NextResponse.json({ success: true, chat: data })
}

export async function DELETE(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { chatId } = await params

  const chat = await loadOwned(chatId, user.workspaceId)
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('scenario_builder_chats')
    .delete()
    .eq('id', chatId)

  if (error) {
    console.error('[builder-chat DELETE] db error:', error)
    return NextResponse.json({ error: 'Failed to delete chat' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
