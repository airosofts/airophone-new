// Two-way Google Sheets sync — per-tab writeback rules, the Sheets sibling of
// /api/automations/writeback. Columns are letters (A, B, …); values are plain
// text ('{{date}}' expands to today's date at write time).
//   GET    /api/automations/sheets-writeback   → rules for this workspace
//   POST   /api/automations/sheets-writeback   → upsert one rule (per spreadsheet+tab)
//   DELETE /api/automations/sheets-writeback?spreadsheet_id=…&sheet_name=…
//
// The hooks that *write* to Sheets live in src/lib/sheets-writeback.js.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('sheets_writeback_configs')
    .select('*')
    .eq('workspace_id', user.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[sheets-writeback GET] error:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
  return NextResponse.json({ configs: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const {
    spreadsheet_id, sheet_id, sheet_name,
    on_sent_column, on_sent_value,
    on_reply_column, on_reply_value,
    on_done_column, on_done_value,
  } = body

  if (!spreadsheet_id) return badRequest('spreadsheet_id is required')
  if (!sheet_name) return badRequest('sheet_name is required')

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('sheets_writeback_configs')
    .upsert(
      {
        workspace_id: user.workspaceId,
        spreadsheet_id: String(spreadsheet_id),
        sheet_id: sheet_id != null ? Number(sheet_id) : null,
        sheet_name: String(sheet_name),
        on_sent_column: on_sent_column || null,
        on_sent_value: on_sent_column ? (on_sent_value ?? null) : null,
        on_reply_column: on_reply_column || null,
        on_reply_value: on_reply_column ? (on_reply_value ?? null) : null,
        on_done_column: on_done_column || null,
        on_done_value: on_done_column ? (on_done_value ?? null) : null,
        updated_at: now,
      },
      { onConflict: 'workspace_id,spreadsheet_id,sheet_name' }
    )
    .select()
    .single()

  if (error) {
    console.error('[sheets-writeback POST] error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ success: true, config: data })
}

export async function DELETE(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const spreadsheetId = searchParams.get('spreadsheet_id')
  const sheetName = searchParams.get('sheet_name')
  if (!spreadsheetId || !sheetName) return badRequest('spreadsheet_id and sheet_name are required')

  const { error } = await supabaseAdmin
    .from('sheets_writeback_configs')
    .delete()
    .eq('workspace_id', user.workspaceId)
    .eq('spreadsheet_id', String(spreadsheetId))
    .eq('sheet_name', String(sheetName))

  if (error) {
    console.error('[sheets-writeback DELETE] error:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
