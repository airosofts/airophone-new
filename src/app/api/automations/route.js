// Monday board automations — list + create.
//   GET  /api/automations  → automations for the workspace
//   POST /api/automations  → create one + register the Monday webhook
//
// Creating an automation registers a webhook on the Monday board. Monday
// validates the URL with a challenge handshake on registration, so this only
// works against a publicly reachable host (production) — not localhost.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { appOrigin, createWebhook, MondayNotConnectedError, MondayApiError } from '@/lib/monday'

const VALID_EVENTS = ['create_item', 'change_column_value', 'move_item_to_group']
const VALID_MODES = ['template', 'ai']

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('monday_automations')
    .select('*')
    .eq('workspace_id', user.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[automations GET] db error:', error)
    return NextResponse.json({ error: 'Failed to load automations' }, { status: 500 })
  }
  return NextResponse.json({ automations: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.userId || !user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    name, board_id, board_name, trigger_event, phone_column_id,
    message_mode, message_template, ai_instructions, sender_phone_number_id,
  } = body

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
