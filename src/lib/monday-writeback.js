// Triggered writebacks to Monday for two-way sync. Both inbound replies and
// "mark conversation done" flow through here so the column-encoding and the
// conversation → Monday-item lookup live in one place.
//
// Best-effort: writeback failures are logged but never throw — we don't want
// a Monday API hiccup to break an inbound message insert or a UI status toggle.

import { supabaseAdmin } from '@/lib/supabase-server'
import { updateColumnValue } from '@/lib/monday'

// Given a conversation, find the Monday item it originated from (if any).
// Returns { boardId, itemId, workspaceId } or null.
async function resolveMondayItem(conversationId) {
  if (!conversationId) return null

  const { data: send } = await supabaseAdmin
    .from('monday_automation_sends')
    .select('automation_id, monday_item_id')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })   // newest if multiple
    .limit(1)
    .maybeSingle()

  if (!send?.automation_id || !send?.monday_item_id) return null

  const { data: automation } = await supabaseAdmin
    .from('monday_automations')
    .select('workspace_id, board_id')
    .eq('id', send.automation_id)
    .maybeSingle()

  if (!automation?.board_id) return null

  return {
    workspaceId: automation.workspace_id,
    boardId: automation.board_id,
    itemId: send.monday_item_id,
  }
}

// Build the JSON payload Monday expects for the given column type.
// `date` columns ignore the configured value and always write "today" — that's
// the common use case (Last Contacted = today) and avoids storing stale values.
function buildColumnValue(columnType, configuredValue) {
  if (columnType === 'date') {
    const today = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
    return { date: today }
  }
  if (columnType === 'status') {
    // configuredValue is stored as { label: 'Engaged' }
    if (configuredValue && typeof configuredValue === 'object' && configuredValue.label) {
      return { label: String(configuredValue.label) }
    }
    return null
  }
  if (columnType === 'text') {
    if (configuredValue && typeof configuredValue === 'object' && configuredValue.text != null) {
      return String(configuredValue.text)
    }
    return null
  }
  return null
}

// Run the writeback for a given event. `event` is 'reply' or 'done'.
export async function runWriteback(conversationId, event) {
  try {
    const link = await resolveMondayItem(conversationId)
    if (!link) return   // conversation wasn't created by a Monday automation

    const { data: config } = await supabaseAdmin
      .from('monday_writeback_configs')
      .select('*')
      .eq('workspace_id', link.workspaceId)
      .eq('board_id', link.boardId)
      .maybeSingle()

    if (!config) return   // no rules set for this board

    const columnId = event === 'reply' ? config.on_reply_column_id : config.on_done_column_id
    const columnType = event === 'reply' ? config.on_reply_column_type : config.on_done_column_type
    const value = event === 'reply' ? config.on_reply_value : config.on_done_value

    if (!columnId || !columnType) return   // nothing configured for this event

    const payload = buildColumnValue(columnType, value)
    if (payload === null) {
      console.warn(`[monday-writeback] ${event}: no payload built (column type ${columnType}, value ${JSON.stringify(value)})`)
      return
    }

    await updateColumnValue(link.workspaceId, link.boardId, link.itemId, columnId, payload)
    console.log(`[monday-writeback] ${event}: updated board ${link.boardId} item ${link.itemId} column ${columnId}`)
  } catch (err) {
    // Never let a writeback error break the calling flow.
    console.error(`[monday-writeback] ${event} failed:`, err.message || err)
  }
}
