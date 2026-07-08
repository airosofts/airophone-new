// Triggered writebacks to Google Sheets for two-way sync — the Sheets sibling
// of monday-writeback.js. Inbound replies and "mark conversation done" flow
// through here (the 'sent' event is fired by the sheets automation sweeper).
//
// Best-effort: writeback failures are logged but never throw — a Sheets API
// hiccup must not break an inbound message insert or a UI status toggle.
//
// The lead's row is re-located BY PHONE at write time (rows shift when the
// sheet is sorted or rows are inserted), using the automation's phone column.

import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getSheetData, updateCell } from '@/lib/google-sheets'

// Given a conversation, find the sheets automation + row it originated from.
// Returns { automation, rowKey } or null.
async function resolveSheetsLink(conversationId) {
  if (!conversationId) return null

  const { data: send } = await supabaseAdmin
    .from('sheets_automation_sends')
    .select('automation_id, row_key')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })   // newest if multiple
    .limit(1)
    .maybeSingle()

  if (!send?.automation_id || !send?.row_key) return null

  const { data: automation } = await supabaseAdmin
    .from('sheets_automations')
    .select('id, workspace_id, spreadsheet_id, sheet_name, phone_column')
    .eq('id', send.automation_id)
    .maybeSingle()

  if (!automation) return null
  return { automation, rowKey: send.row_key }
}

// '{{date}}' in a configured value expands to today (YYYY-MM-DD) so a plain
// text column can double as a "Last Contacted" date column.
function expandValue(value) {
  const today = new Date().toISOString().slice(0, 10)
  return String(value ?? '').replace(/\{\{\s*date\s*\}\}/gi, today)
}

// Run the writeback for a given event. `event` is 'sent' | 'reply' | 'done'.
export async function runSheetsWriteback(conversationId, event) {
  try {
    const link = await resolveSheetsLink(conversationId)
    if (!link) return   // conversation didn't originate from a sheets automation

    const { automation, rowKey } = link
    const { data: config } = await supabaseAdmin
      .from('sheets_writeback_configs')
      .select('*')
      .eq('workspace_id', automation.workspace_id)
      .eq('spreadsheet_id', automation.spreadsheet_id)
      .eq('sheet_name', automation.sheet_name)
      .maybeSingle()

    if (!config) return

    const COLS = {
      sent:  ['on_sent_column',  'on_sent_value'],
      reply: ['on_reply_column', 'on_reply_value'],
      done:  ['on_done_column',  'on_done_value'],
    }
    const [colField, valField] = COLS[event] || COLS.done
    const column = config[colField]
    if (!column) return   // nothing configured for this event

    // Re-locate the lead's row by phone.
    const { rows } = await getSheetData(automation.workspace_id, automation.spreadsheet_id, automation.sheet_name)
    const row = rows.find(r =>
      normalizePhoneNumber(r.values[automation.phone_column] || '') === rowKey
    )
    if (!row) {
      console.log(`[sheets-writeback] ${event}: skipped — row for ${rowKey} no longer in the sheet`)
      return
    }

    const value = expandValue(config[valField])
    await updateCell(automation.workspace_id, automation.spreadsheet_id, automation.sheet_name, column, row.rowNumber, value)
    console.log(`[sheets-writeback] ${event}: ✅ ${automation.sheet_name}!${column}${row.rowNumber} → "${value}"`)
  } catch (err) {
    // Never let a writeback error break the calling flow.
    console.error(`[sheets-writeback] ${event} failed:`, err?.message || err)
  }
}
