// Shared processing for a Monday board automation: given an automation and a
// Monday item id, build the message and text the lead. Used by both the
// webhook receiver (immediate) and the process-pending sweeper (retry, for
// leads whose phone column fills in after the item was created).
//
// Returns an outcome — the caller owns the monday_automation_sends row:
//   { status: 'sent',    conversationId, messageId }
//   { status: 'pending', detail }   ← phone column not filled yet, retry later
//   { status: 'failed',  detail }   ← hard failure, do not retry

import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getAIResponse } from '@/lib/openai'
import { getItem, listColumns, extractPhone, columnTitleToPlaceholder } from '@/lib/monday'

async function buildMessage(automation, item, columns) {
  if (automation.message_mode === 'ai') {
    const fields = (item.column_values || [])
      .map(cv => {
        const col = columns.find(c => c.id === cv.id)
        return col && cv.text ? `${col.title}: ${cv.text}` : null
      })
      .filter(Boolean)
      .join('\n')
    const prompt = `${automation.ai_instructions}\n\n--- LEAD DETAILS ---\nName: ${item.name || ''}\n${fields}\n\nWrite a single, friendly opening SMS to this lead. Output only the message text.`
    const ai = await getAIResponse([], prompt)
    if (!ai.success) throw new Error(`AI generation failed: ${ai.error}`)
    return ai.response.trim()
  }

  // Template mode — substitute {{column_slug}} and {{name}}.
  const slugToText = { name: item.name || '' }
  const byId = new Map((item.column_values || []).map(cv => [cv.id, cv]))
  for (const col of columns) {
    slugToText[columnTitleToPlaceholder(col.title)] = byId.get(col.id)?.text || ''
  }
  return (automation.message_template || '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (slugToText[k] ?? ''))
    .replace(/\{(\w+)\}/g, (_, k) => (slugToText[k] ?? ''))
}

export async function processAutomationItem(automation, itemId) {
  try {
    // Sender number
    const { data: senderPhone } = await supabaseAdmin
      .from('phone_numbers')
      .select('phone_number')
      .eq('id', automation.sender_phone_number_id)
      .maybeSingle()
    if (!senderPhone?.phone_number) {
      return { status: 'failed', detail: 'Sender number not found' }
    }

    // Item + board columns from Monday
    const [item, columns] = await Promise.all([
      getItem(automation.workspace_id, itemId),
      listColumns(automation.workspace_id, automation.board_id),
    ])
    if (!item) return { status: 'failed', detail: 'Monday item not found' }

    // Lead phone — the crux: a freshly-created item may not have it yet.
    const phoneCv = (item.column_values || []).find(cv => cv.id === automation.phone_column_id)
    const leadPhone = normalizePhoneNumber(extractPhone(phoneCv))
    if (!leadPhone) {
      return { status: 'pending', detail: 'Phone column not filled yet — will retry' }
    }

    const senderNumber = normalizePhoneNumber(senderPhone.phone_number)
    const messageText = await buildMessage(automation, item, columns)
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
          name: item.name || null,
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

    return { status: 'sent', conversationId: conversation.id, messageId: messageRow?.id || null }
  } catch (err) {
    console.error('[monday-automation] processAutomationItem error:', err)
    return { status: 'failed', detail: String(err.message || err).slice(0, 400) }
  }
}
