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

// Write a status LABEL to a Monday status column for the item behind this
// conversation. Used by per-follow-up-stage updates ("1st follow-up sent").
// The caller passes the exact status column the user picked in the follow-up
// editor; if it's missing (legacy rows) we fall back to whichever two-way-sync
// column is a status type. Best-effort; never throws.
export async function writeStatusLabel(conversationId, label, columnId = null) {
  try {
    const clean = (label || '').trim()
    if (!clean) return

    const link = await resolveMondayItem(conversationId)
    if (!link) {
      console.log(`[monday-writeback] stage-status "${clean}": skipped — conversation ${conversationId} has no Monday item link`)
      return
    }

    let statusColId = columnId || null
    if (!statusColId) {
      const { data: config } = await supabaseAdmin
        .from('monday_writeback_configs')
        .select('*')
        .eq('workspace_id', link.workspaceId)
        .eq('board_id', link.boardId)
        .maybeSingle()
      if (config) {
        statusColId =
          (config.on_sent_column_type === 'status' && config.on_sent_column_id) ||
          (config.on_reply_column_type === 'status' && config.on_reply_column_id) ||
          (config.on_done_column_type === 'status' && config.on_done_column_id) || null
      }
    }
    if (!statusColId) {
      console.log(`[monday-writeback] stage-status "${clean}": skipped — no status column to write for board ${link.boardId}`)
      return
    }

    await updateColumnValue(link.workspaceId, link.boardId, link.itemId, statusColId, { label: clean })
    console.log(`[monday-writeback] stage-status: board ${link.boardId} item ${link.itemId} column ${statusColId} → "${clean}"`)
  } catch (err) {
    console.error('[monday-writeback] writeStatusLabel failed:', err?.message || err, err?.errors || '')
  }
}

// Run the writeback for a given event. `event` is 'sent' | 'reply' | 'done'.
//   'sent'  → the first AI/template message just went out (Status → "AI Engaged")
//   'reply' → the lead replied        (Status → "Replied" / "Engaged")
//   'done'  → conversation closed     (Status → "Done")
export async function runWriteback(conversationId, event) {
  try {
    console.log(`[monday-writeback] ${event}: starting for conversation ${conversationId}`)

    const link = await resolveMondayItem(conversationId)
    if (!link) {
      console.log(`[monday-writeback] ${event}: skipped — no monday_automation_sends row links this conversation (conversation wasn't created by a Monday automation, or the link is missing)`)
      return
    }
    console.log(`[monday-writeback] ${event}: resolved link`, link)

    const { data: config, error: cfgErr } = await supabaseAdmin
      .from('monday_writeback_configs')
      .select('*')
      .eq('workspace_id', link.workspaceId)
      .eq('board_id', link.boardId)
      .maybeSingle()

    if (cfgErr) {
      console.error(`[monday-writeback] ${event}: config query error`, cfgErr)
      return
    }
    if (!config) {
      console.log(`[monday-writeback] ${event}: skipped — no writeback config for board ${link.boardId}`)
      return
    }

    const COLS = {
      sent:  ['on_sent_column_id',  'on_sent_column_type',  'on_sent_value'],
      reply: ['on_reply_column_id', 'on_reply_column_type', 'on_reply_value'],
      done:  ['on_done_column_id',  'on_done_column_type',  'on_done_value'],
    }
    const COL = COLS[event] || COLS.done
    const columnId = config[COL[0]]
    const columnType = config[COL[1]]
    const value = config[COL[2]]

    if (!columnId || !columnType) {
      console.log(`[monday-writeback] ${event}: skipped — nothing configured for this event (columnId=${columnId}, columnType=${columnType})`)
      return
    }

    const payload = buildColumnValue(columnType, value)
    if (payload === null) {
      console.warn(`[monday-writeback] ${event}: no payload built (column type ${columnType}, value ${JSON.stringify(value)})`)
      return
    }

    console.log(`[monday-writeback] ${event}: calling Monday updateColumnValue`, {
      board: link.boardId, item: link.itemId, column: columnId, payload,
    })
    await updateColumnValue(link.workspaceId, link.boardId, link.itemId, columnId, payload)
    console.log(`[monday-writeback] ${event}: ✅ updated board ${link.boardId} item ${link.itemId} column ${columnId}`)
  } catch (err) {
    // Never let a writeback error break the calling flow.
    console.error(`[monday-writeback] ${event} failed:`, err?.message || err, err?.errors || '')
  }
}
