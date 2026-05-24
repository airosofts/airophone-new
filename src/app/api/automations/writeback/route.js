// Two-way Monday sync — per-board writeback rules.
//   GET    /api/automations/writeback        → list rules for this workspace
//   POST   /api/automations/writeback        → upsert one rule (one per board)
//   DELETE /api/automations/writeback?board_id=...  → remove a rule
//
// The hooks that *call* Monday live in src/lib/monday-writeback.js — this
// route only manages the config rows.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

const VALID_TYPES = ['status', 'date', 'text']

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('monday_writeback_configs')
    .select('*')
    .eq('workspace_id', user.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[writeback GET] error:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
  return NextResponse.json({ configs: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const {
    board_id, board_name,
    on_reply_column_id, on_reply_column_type, on_reply_value,
    on_done_column_id, on_done_column_type, on_done_value,
  } = body

  if (!board_id) return badRequest('board_id is required')

  // Validate types when set (column is optional, but if set the type must be valid).
  if (on_reply_column_id && !VALID_TYPES.includes(on_reply_column_type)) {
    return badRequest(`on_reply_column_type must be one of: ${VALID_TYPES.join(', ')}`)
  }
  if (on_done_column_id && !VALID_TYPES.includes(on_done_column_type)) {
    return badRequest(`on_done_column_type must be one of: ${VALID_TYPES.join(', ')}`)
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('monday_writeback_configs')
    .upsert(
      {
        workspace_id: user.workspaceId,
        board_id: String(board_id),
        board_name: board_name || null,
        on_reply_column_id: on_reply_column_id || null,
        on_reply_column_type: on_reply_column_id ? on_reply_column_type : null,
        on_reply_value: on_reply_column_id ? (on_reply_value ?? null) : null,
        on_done_column_id: on_done_column_id || null,
        on_done_column_type: on_done_column_id ? on_done_column_type : null,
        on_done_value: on_done_column_id ? (on_done_value ?? null) : null,
        updated_at: now,
      },
      { onConflict: 'workspace_id,board_id' }
    )
    .select()
    .single()

  if (error) {
    console.error('[writeback POST] error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ success: true, config: data })
}

export async function DELETE(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const boardId = searchParams.get('board_id')
  if (!boardId) return badRequest('board_id is required')

  const { error } = await supabaseAdmin
    .from('monday_writeback_configs')
    .delete()
    .eq('workspace_id', user.workspaceId)
    .eq('board_id', String(boardId))

  if (error) {
    console.error('[writeback DELETE] error:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
