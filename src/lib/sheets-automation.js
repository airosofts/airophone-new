// Google Sheets automations — the Sheets sibling of monday-automation.js.
//
// Sheets has no usable webhooks, so "new row → send SMS" is cron-polled:
// sweepSheetsAutomations() (called from the process-pending sweeper) polls
// each active automation's tab, enqueues sends for unseen rows, and then
// processes due pending/scheduled sends.
//
// Row identity is the NORMALIZED PHONE in the automation's phone column
// (sheets_automation_sends.row_key) — row numbers shift, phones don't.
// Rows present when the automation is created are stored as 'baseline'
// (by the create route) so only rows added later ever trigger a text.

import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getAIResponse } from '@/lib/openai'
import { getSheetData, buildRowVars, SheetsNotConnectedError } from '@/lib/google-sheets'
import { armFollowupsForSend } from '@/lib/followup-service'
import { isInBusinessHours, nextBusinessTime, nextOutsideBusinessTime } from '@/lib/scheduling'

const MAX_WAIT_MIN = 120
const STALE_SCHEDULED_MIN = 60
const BATCH = 100

async function buildMessage(automation, vars, headers) {
  if (automation.message_mode === 'ai') {
    const fields = headers
      .map(h => (vars[h.placeholder] ? `${h.title}: ${vars[h.placeholder]}` : null))
      .filter(Boolean)
      .join('\n')
    const prompt = `${automation.ai_instructions}\n\n--- LEAD DETAILS ---\n${fields}\n\nWrite a single, friendly opening SMS to this lead. Output only the message text.`
    const ai = await getAIResponse([], prompt)
    if (!ai.success) throw new Error(`AI generation failed: ${ai.error}`)
    return ai.response.trim()
  }

  return (automation.message_template || '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}

// Send the automation's message to one row. Mirrors processAutomationItem:
//   { status: 'sent', conversationId, messageId } | { status: 'failed', detail }
// (No 'pending' state — a sheets send only exists once the phone is filled.)
export async function processSheetsRow(automation, row, headers) {
  try {
    const { data: senderPhone } = await supabaseAdmin
      .from('phone_numbers')
      .select('phone_number')
      .eq('id', automation.sender_phone_number_id)
      .maybeSingle()
    if (!senderPhone?.phone_number) {
      return { status: 'failed', detail: 'Sender number not found' }
    }

    const leadPhone = normalizePhoneNumber(row.values[automation.phone_column] || '')
    if (!leadPhone) return { status: 'failed', detail: 'Phone cell is empty or invalid' }

    const senderNumber = normalizePhoneNumber(senderPhone.phone_number)
    const vars = buildRowVars(headers, row, automation.phone_column)
    const messageText = await buildMessage(automation, vars, headers)
    if (!messageText?.trim()) return { status: 'failed', detail: 'Empty message' }

    const result = await telnyx.sendMessage(senderNumber, leadPhone, messageText)
    if (!result.success) return { status: 'failed', detail: 'Telnyx send failed' }

    // Get-or-create the conversation (unique on phone_number + from_number).
    let conversation
    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('phone_number', leadPhone)
      .eq('from_number', senderNumber)
      .maybeSingle()
    if (existing) {
      conversation = existing
    } else {
      const { data: created, error: convErr } = await supabaseAdmin
        .from('conversations')
        .insert({
          phone_number: leadPhone,
          from_number: senderNumber,
          name: vars.name || null,
          workspace_id: automation.workspace_id,
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (convErr && convErr.code === '23505') {
        const { data: fallback } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('phone_number', leadPhone)
          .eq('from_number', senderNumber)
          .single()
        conversation = fallback
      } else if (convErr) {
        throw convErr
      } else {
        conversation = created
      }
    }

    const { data: messageRow } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        telnyx_message_id: result.messageId,
        direction: 'outbound',
        from_number: senderNumber,
        to_number: leadPhone,
        body: messageText,
        status: 'sending',
      })
      .select('id')
      .single()

    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation.id)

    // Arm follow-ups — same reasoning as the Monday automation path.
    await armFollowupsForSend(conversation.id, senderNumber)

    return { status: 'sent', conversationId: conversation.id, messageId: messageRow?.id || null }
  } catch (err) {
    console.error('[sheets-automation] processSheetsRow error:', err)
    return { status: 'failed', detail: String(err.message || err).slice(0, 400) }
  }
}

// Snapshot every current row as 'baseline' — called on automation creation so
// pre-existing leads never get texted. Returns how many rows were recorded.
export async function baselineExistingRows(automation) {
  const { rows } = await getSheetData(
    automation.workspace_id, automation.spreadsheet_id, automation.sheet_name
  )
  const ledger = []
  for (const row of rows) {
    const key = normalizePhoneNumber(row.values[automation.phone_column] || '')
    if (!key) continue
    ledger.push({
      automation_id: automation.id,
      row_key: key,
      row_number: row.rowNumber,
      status: 'baseline',
      detail: 'Row existed when the automation was created',
    })
  }
  for (let i = 0; i < ledger.length; i += 500) {
    await supabaseAdmin
      .from('sheets_automation_sends')
      .upsert(ledger.slice(i, i + 500), { onConflict: 'automation_id,row_key', ignoreDuplicates: true })
  }
  return ledger.length
}

// Poll one automation's tab for rows we haven't seen; enqueue a send per new
// row ('pending' for immediate, 'scheduled' when there's a delay).
async function pollAutomation(automation) {
  let headers, rows
  try {
    ({ headers, rows } = await getSheetData(
      automation.workspace_id, automation.spreadsheet_id, automation.sheet_name
    ))
  } catch (err) {
    if (err instanceof SheetsNotConnectedError) {
      console.warn(`[sheets-automation] ${automation.id}: skipped — not connected`)
      return { discovered: 0 }
    }
    throw err
  }

  const { data: seen } = await supabaseAdmin
    .from('sheets_automation_sends')
    .select('row_key')
    .eq('automation_id', automation.id)
  const seenKeys = new Set((seen || []).map(s => s.row_key))

  let discovered = 0
  for (const row of rows) {
    const key = normalizePhoneNumber(row.values[automation.phone_column] || '')
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)

    const delaySec = Math.max(0, Number(automation.send_delay_seconds) || 0)
    const { error } = await supabaseAdmin
      .from('sheets_automation_sends')
      .insert({
        automation_id: automation.id,
        row_key: key,
        row_number: row.rowNumber,
        status: delaySec > 0 ? 'scheduled' : 'pending',
        scheduled_at: delaySec > 0 ? new Date(Date.now() + delaySec * 1000).toISOString() : null,
      })
    if (!error) discovered++
    else if (error.code !== '23505') console.error('[sheets-automation] enqueue error:', error)
  }

  await supabaseAdmin
    .from('sheets_automations')
    .update({ last_polled_at: new Date().toISOString() })
    .eq('id', automation.id)

  return { discovered, headers, rows }
}

// The full sweep: poll every active automation, then process due sends.
// Called from /api/automations/process-pending on the cron tick.
export async function sweepSheetsAutomations() {
  const { data: automations, error } = await supabaseAdmin
    .from('sheets_automations')
    .select('*')
    .eq('is_active', true)

  if (error) {
    console.error('[sheets-automation] sweep query error:', error)
    return { error: error.message }
  }
  if (!automations?.length) return { automations: 0, discovered: 0, sent: 0, gaveUp: 0, stillPending: 0 }

  // 1) Poll — also caches each automation's sheet data for the send phase so
  // we don't fetch the same tab twice in one tick.
  let discovered = 0
  const sheetCache = new Map()   // automation.id → { headers, rows }
  for (const automation of automations) {
    try {
      const result = await pollAutomation(automation)
      discovered += result.discovered || 0
      if (result.headers) sheetCache.set(automation.id, { headers: result.headers, rows: result.rows })
    } catch (err) {
      console.error(`[sheets-automation] poll failed for ${automation.id}:`, err.message)
    }
  }

  // 2) Process due sends.
  const nowIso = new Date().toISOString()
  const autoById = new Map(automations.map(a => [a.id, a]))
  const { data: dueRows } = await supabaseAdmin
    .from('sheets_automation_sends')
    .select('id, automation_id, row_key, row_number, created_at, status, scheduled_at')
    .in('status', ['pending', 'scheduled'])
    .in('automation_id', automations.map(a => a.id))
    .or(`status.eq.pending,scheduled_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  // Business hours per workspace, loaded once.
  const wsIds = [...new Set(automations.map(a => a.workspace_id))]
  const wsHoursById = new Map()
  if (wsIds.length) {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('id, business_hours_enabled, business_hours_start, business_hours_end, business_hours_tz, business_days')
      .in('id', wsIds)
    for (const w of (ws || [])) wsHoursById.set(w.id, w)
  }

  let sent = 0, gaveUp = 0, stillPending = 0
  const cutoff = Date.now() - MAX_WAIT_MIN * 60 * 1000

  for (const sendRow of (dueRows || [])) {
    const automation = autoById.get(sendRow.automation_id)
    if (!automation) {
      await supabaseAdmin.from('sheets_automation_sends')
        .update({ status: 'failed', detail: 'Automation removed or paused' })
        .eq('id', sendRow.id)
      gaveUp++
      continue
    }

    // Staleness guard — same reasoning as the Monday sweeper: after an outage,
    // drop long-overdue scheduled sends rather than surprise-firing them.
    if (sendRow.status === 'scheduled' && sendRow.scheduled_at) {
      const ageMin = (Date.now() - new Date(sendRow.scheduled_at).getTime()) / 60000
      if (ageMin > STALE_SCHEDULED_MIN) {
        await supabaseAdmin.from('sheets_automation_sends')
          .update({ status: 'failed', detail: `Stale: scheduled_at was ${Math.round(ageMin)} min in the past (sweeper outage?)` })
          .eq('id', sendRow.id)
        gaveUp++
        continue
      }
    }

    // Business-hours gate.
    const mode = automation.business_hours_mode || 'anytime'
    const hours = wsHoursById.get(automation.workspace_id)
    if (mode !== 'anytime' && hours) {
      const inHours = isInBusinessHours(new Date(), hours)
      let nextAt = null
      if (mode === 'within' && !inHours) nextAt = nextBusinessTime(new Date(), hours)
      else if (mode === 'outside' && inHours) nextAt = nextOutsideBusinessTime(new Date(), hours)
      if (nextAt) {
        await supabaseAdmin.from('sheets_automation_sends')
          .update({ status: 'scheduled', scheduled_at: nextAt.toISOString() })
          .eq('id', sendRow.id)
        stillPending++
        continue
      }
    }

    // Re-locate the row by phone in the (cached) sheet — the lead may have
    // been re-sorted since discovery, and cells may have filled in since.
    const cached = sheetCache.get(automation.id)
    let row = null, headers = cached?.headers || []
    if (cached) {
      row = cached.rows.find(r =>
        normalizePhoneNumber(r.values[automation.phone_column] || '') === sendRow.row_key
      ) || null
    }
    if (!row) {
      // Row deleted from the sheet before its send came due — give up quietly,
      // unless it might simply be a transient fetch failure that aged out.
      if (new Date(sendRow.created_at).getTime() < cutoff) {
        await supabaseAdmin.from('sheets_automation_sends')
          .update({ status: 'failed', detail: 'Row no longer found in the sheet' })
          .eq('id', sendRow.id)
        gaveUp++
      } else {
        stillPending++
      }
      continue
    }

    const outcome = await processSheetsRow(automation, row, headers)
    await supabaseAdmin.from('sheets_automation_sends')
      .update({
        status: outcome.status,
        detail: outcome.detail || null,
        conversation_id: outcome.conversationId || null,
        message_id: outcome.messageId || null,
      })
      .eq('id', sendRow.id)

    if (outcome.status === 'sent') {
      sent++
      // Two-way sync: mark the row (e.g. Status → "AI Engaged"). Best-effort.
      if (outcome.conversationId) {
        const { runSheetsWriteback } = await import('@/lib/sheets-writeback')
        runSheetsWriteback(outcome.conversationId, 'sent').catch(() => {})
      }
    } else {
      gaveUp++
    }
  }

  return { automations: automations.length, discovered, sent, gaveUp, stillPending }
}
