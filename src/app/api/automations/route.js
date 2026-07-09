// Board/sheet automations — list + create.
//   GET  /api/automations  → automations for the workspace (Monday + Google Sheets,
//                            each row tagged with source: 'monday' | 'sheets')
//   POST /api/automations  → create one. body.source picks the provider:
//     - 'monday' (default) → registers a Monday webhook (needs a public URL)
//     - 'sheets'           → no webhook; the cron sweeper polls the tab for new rows

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { appOrigin, createWebhook, MondayNotConnectedError, MondayApiError } from '@/lib/monday'
import { SheetsNotConnectedError } from '@/lib/google-sheets'
import { baselineExistingRows } from '@/lib/sheets-automation'

const VALID_EVENTS = ['create_item', 'change_column_value', 'move_item_to_group']
const VALID_MODES = ['template', 'ai']

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: monday, error }, { data: sheets, error: sheetsErr }] = await Promise.all([
    supabaseAdmin
      .from('monday_automations')
      .select('*')
      .eq('workspace_id', user.workspaceId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('sheets_automations')
      .select('*')
      .eq('workspace_id', user.workspaceId)
      .order('created_at', { ascending: false }),
  ])

  if (error || sheetsErr) {
    console.error('[automations GET] db error:', error || sheetsErr)
    return NextResponse.json({ error: 'Failed to load automations' }, { status: 500 })
  }

  const automations = [
    ...(monday || []).map(a => ({ ...a, source: 'monday' })),
    ...(sheets || []).map(a => ({ ...a, source: 'sheets' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return NextResponse.json({ automations })
}

// ── Google Sheets automation create — polled, no webhook ────────────────────
async function createSheetsAutomation(user, body) {
  const {
    name, spreadsheet_id, spreadsheet_name, sheet_id, sheet_name, phone_column,
    message_mode, message_template, ai_instructions, sender_phone_number_id,
    send_delay_seconds, business_hours_mode, graph,
  } = body

  const bhMode = ['anytime', 'within', 'outside'].includes(business_hours_mode)
    ? business_hours_mode : 'anytime'

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!spreadsheet_id) return NextResponse.json({ error: 'Spreadsheet is required' }, { status: 400 })
  if (!sheet_name) return NextResponse.json({ error: 'Sheet tab is required' }, { status: 400 })
  if (!phone_column) return NextResponse.json({ error: 'Phone column is required' }, { status: 400 })
  if (!sender_phone_number_id) return NextResponse.json({ error: 'Sender number is required' }, { status: 400 })
  if (!VALID_MODES.includes(message_mode)) {
    return NextResponse.json({ error: 'Invalid message mode' }, { status: 400 })
  }
  if (message_mode === 'template' && !message_template?.trim()) {
    return NextResponse.json({ error: 'Message template is required' }, { status: 400 })
  }
  if (message_mode === 'ai' && !ai_instructions?.trim()) {
    return NextResponse.json({ error: 'AI instructions are required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('sheets_automations')
    .insert({
      workspace_id: user.workspaceId,
      name: name.trim(),
      spreadsheet_id: String(spreadsheet_id),
      spreadsheet_name: spreadsheet_name || null,
      sheet_id: sheet_id != null ? Number(sheet_id) : null,
      sheet_name: String(sheet_name),
      trigger_event: 'new_row',
      phone_column: String(phone_column),
      message_mode,
      message_template: message_mode === 'template' ? message_template.trim() : null,
      ai_instructions: message_mode === 'ai' ? ai_instructions.trim() : null,
      sender_phone_number_id: String(sender_phone_number_id),
      send_delay_seconds: Math.max(0, Math.min(7 * 24 * 60 * 60, Number(send_delay_seconds) || 0)),
      business_hours_mode: bhMode,
      graph: graph && typeof graph === 'object' ? graph : null,
      created_by: user.userId,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (error) {
    console.error('[automations POST sheets] db insert failed:', error)
    return NextResponse.json({ error: 'Failed to save automation' }, { status: 500 })
  }

  // Snapshot rows that already exist so they never get texted — only rows
  // added AFTER this moment trigger. This also validates sheet access: if the
  // fetch fails, roll the automation back rather than leave one that would
  // blast the whole sheet on the first successful poll.
  try {
    const baselined = await baselineExistingRows(data)
    console.log(`[automations POST sheets] baselined ${baselined} existing rows for ${data.id}`)
  } catch (err) {
    await supabaseAdmin.from('sheets_automations').delete().eq('id', data.id)
    if (err instanceof SheetsNotConnectedError) {
      return NextResponse.json({ error: 'Google Sheets is not connected. Connect it in Settings → Integrations.' }, { status: 400 })
    }
    console.error('[automations POST sheets] baseline failed:', err)
    return NextResponse.json({ error: `Could not read the sheet: ${err.message}` }, { status: 502 })
  }

  return NextResponse.json({ success: true, automation: { ...data, source: 'sheets' } })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.userId || !user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()

  if (body.source === 'sheets') {
    return createSheetsAutomation(user, body)
  }
  const {
    name, board_id, board_name, trigger_event, phone_column_id,
    message_mode, message_template, ai_instructions, sender_phone_number_id,
    send_delay_seconds, respect_business_hours, business_hours_mode, graph,
  } = body

  // Business-hours mode: 'anytime' | 'within' | 'outside'. Accept the legacy
  // boolean too (true → 'within') so older clients keep working.
  const VALID_BH_MODES = ['anytime', 'within', 'outside']
  const bhMode = VALID_BH_MODES.includes(business_hours_mode)
    ? business_hours_mode
    : (respect_business_hours ? 'within' : 'anytime')

  // Validation
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!board_id) return NextResponse.json({ error: 'Board is required' }, { status: 400 })
  if (!phone_column_id) return NextResponse.json({ error: 'Phone column is required' }, { status: 400 })
  if (!sender_phone_number_id) return NextResponse.json({ error: 'Sender number is required' }, { status: 400 })
  if (!VALID_EVENTS.includes(trigger_event)) {
    return NextResponse.json({ error: 'Invalid trigger event' }, { status: 400 })
  }
  if (!VALID_MODES.includes(message_mode)) {
    return NextResponse.json({ error: 'Invalid message mode' }, { status: 400 })
  }
  if (message_mode === 'template' && !message_template?.trim()) {
    return NextResponse.json({ error: 'Message template is required' }, { status: 400 })
  }
  if (message_mode === 'ai' && !ai_instructions?.trim()) {
    return NextResponse.json({ error: 'AI instructions are required' }, { status: 400 })
  }

  // Register the webhook on Monday's side first — if this fails we don't want
  // a dangling automation row.
  const webhookUrl = `${appOrigin(request)}/api/webhooks/monday`
  let webhookId
  try {
    webhookId = await createWebhook(user.workspaceId, board_id, webhookUrl, trigger_event)
    if (!webhookId) throw new Error('Monday did not return a webhook id')
  } catch (err) {
    if (err instanceof MondayNotConnectedError) {
      return NextResponse.json({ error: 'Monday is not connected. Connect it in Settings → Integrations.' }, { status: 400 })
    }
    if (err instanceof MondayApiError) {
      // Most common cause: Monday couldn't reach the webhook URL (e.g. localhost).
      console.error('[automations POST] webhook registration failed:', err.message)
      return NextResponse.json(
        { error: `Monday rejected the webhook: ${err.message}. The webhook URL must be publicly reachable.` },
        { status: 502 }
      )
    }
    console.error('[automations POST] webhook error:', err)
    return NextResponse.json({ error: 'Failed to register the Monday webhook' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('monday_automations')
    .insert({
      workspace_id: user.workspaceId,
      name: name.trim(),
      board_id: String(board_id),
      board_name: board_name || null,
      trigger_event,
      monday_webhook_id: webhookId,
      phone_column_id: String(phone_column_id),
      message_mode,
      message_template: message_mode === 'template' ? message_template.trim() : null,
      ai_instructions: message_mode === 'ai' ? ai_instructions.trim() : null,
      sender_phone_number_id: String(sender_phone_number_id),
      // Scheduling — clamp delay 0–7 days; toggle defaults off.
      send_delay_seconds: Math.max(0, Math.min(7 * 24 * 60 * 60, Number(send_delay_seconds) || 0)),
      respect_business_hours: bhMode === 'within',   // keep legacy column in sync
      business_hours_mode: bhMode,
      graph: graph && typeof graph === 'object' ? graph : null,
      created_by: user.userId,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (error) {
    console.error('[automations POST] db insert failed:', error)
    // Best-effort: the webhook is now orphaned on Monday's side. Logged for cleanup.
    console.error(`[automations POST] ORPHANED Monday webhook ${webhookId} on board ${board_id}`)
    return NextResponse.json({ error: 'Failed to save automation' }, { status: 500 })
  }

  return NextResponse.json({ success: true, automation: data })
}
