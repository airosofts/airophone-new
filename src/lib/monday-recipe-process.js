// Shared processing for a Monday Integration Recipe run: given a workspace,
// a board+item, and the recipe's inputFields, render the message and send it.
//
// Used by:
//   - /api/integrations/monday/recipe/execute — first attempt (live trigger)
//   - /api/automations/process-pending — sweeper retry when phone column was
//     empty at trigger time (form-fill latency)
//
// Returns an outcome — the caller updates the monday_recipe_runs row:
//   { status: 'sent',    conversationId, messageId }
//   { status: 'pending', detail }   ← phone column not filled yet, retry later
//   { status: 'failed',  detail }   ← hard failure, do not retry

import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getItem, listColumns, extractPhone, columnTitleToPlaceholder } from '@/lib/monday'

export function renderRecipeMessage(template, item, columns) {
  if (!template) return ''
  const slugToText = { name: item.name || '', 'pulse.name': item.name || '' }
  const byId = new Map((item.column_values || []).map(cv => [cv.id, cv]))
  for (const col of columns) {
    const text = byId.get(col.id)?.text || ''
    slugToText[columnTitleToPlaceholder(col.title)] = text
    slugToText[`pulse.${col.title}`] = text
    slugToText[`pulse.${col.id}`] = text
  }
  return template
    .replace(/\{\{([^}]+)\}\}/g, (_, k) => slugToText[k.trim()] ?? '')
    .replace(/\{([^}]+)\}/g, (_, k) => slugToText[k.trim()] ?? '')
}

export async function getOrCreateRecipeConversation({ workspaceId, fromNumber, leadPhone, leadName }) {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('from_number', fromNumber)
    .eq('phone_number', leadPhone)
    .maybeSingle()
  if (existing) return existing

  const { data: created } = await supabaseAdmin
    .from('conversations')
    .insert({
      workspace_id: workspaceId,
      from_number:  fromNumber,
      phone_number: leadPhone,
      contact_name: leadName || null,
      source:       'monday_recipe',
    })
    .select('id')
    .single()
  return created
}

// Monday sometimes sends a custom field-type value either as the raw value
// (the uuid we returned from the dropdown) or wrapped — e.g.
//   "abc-123"
//   { "value": "abc-123" }
//   { "value": "abc-123", "title": "+1 555…" }
//   "{\"value\":\"abc-123\"}"   (stringified)
// Pull the uuid out of whichever shape arrived.
function unwrapFieldValue(v) {
  if (v == null) return null
  if (typeof v === 'string') {
    // Try parsing in case monday stringified the object.
    if (v.startsWith('{')) {
      try {
        const parsed = JSON.parse(v)
        if (parsed && typeof parsed === 'object') return parsed.value ?? null
      } catch {}
    }
    return v
  }
  if (typeof v === 'object') return v.value ?? null
  return String(v)
}

export async function processRecipeRun({ workspaceId, boardId, itemId, inputFields }) {
  const phoneColumnId = unwrapFieldValue(inputFields?.phoneColumnId)
  const senderNumberId = unwrapFieldValue(inputFields?.senderNumberId)
  const messageTemplate = typeof inputFields?.messageTemplate === 'string'
    ? inputFields.messageTemplate
    : unwrapFieldValue(inputFields?.messageTemplate)

  if (!phoneColumnId || !senderNumberId) {
    return { status: 'failed', detail: `Missing input fields (phoneColumnId=${!!phoneColumnId}, senderNumberId=${!!senderNumberId})` }
  }

  // Defense in depth: re-verify the sender number belongs to this workspace
  // (the dropdown filters by workspace, but never trust the recipe payload).
  const { data: sender } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, phone_number, workspace_id, is_active')
    .eq('id', senderNumberId)
    .maybeSingle()
  if (!sender) {
    return { status: 'failed', detail: `Sender number not found (id=${senderNumberId})` }
  }
  if (sender.workspace_id !== workspaceId) {
    return {
      status: 'failed',
      detail: `Sender number belongs to a different workspace (sender.workspace=${sender.workspace_id}, recipe.workspace=${workspaceId})`,
    }
  }

  // Fetch item + columns using the workspace's stored monday OAuth token.
  let item, columns
  try {
    ;[item, columns] = await Promise.all([
      getItem(workspaceId, itemId),
      listColumns(workspaceId, boardId),
    ])
  } catch (err) {
    return { status: 'failed', detail: `Monday fetch failed: ${err.message}` }
  }
  if (!item) return { status: 'failed', detail: 'Monday item not found' }

  // Lead phone — may not be filled yet on a brand-new item. Stay 'pending'
  // and let the sweeper retry until it fills or ages out.
  const phoneCv = (item.column_values || []).find(cv => cv.id === phoneColumnId)
  const leadPhone = normalizePhoneNumber(extractPhone(phoneCv))
  if (!leadPhone) {
    return { status: 'pending', detail: 'Phone column not filled yet' }
  }

  const messageText = renderRecipeMessage(messageTemplate, item, columns).trim()
  if (!messageText) return { status: 'failed', detail: 'Empty message' }

  const fromNumber = normalizePhoneNumber(sender.phone_number)
  const result = await telnyx.sendMessage(fromNumber, leadPhone, messageText)
  if (!result.success) return { status: 'failed', detail: 'Telnyx send failed' }

  const conversation = await getOrCreateRecipeConversation({
    workspaceId, fromNumber, leadPhone, leadName: item.name,
  })

  await supabaseAdmin.from('messages').insert({
    conversation_id: conversation.id,
    workspace_id:    workspaceId,
    from_number:     fromNumber,
    to_number:       leadPhone,
    body:            messageText,
    direction:       'outbound',
    status:          'sent',
    telnyx_id:       result.messageId || null,
  })

  return {
    status: 'sent',
    conversationId: conversation.id,
    messageId: result.messageId || null,
  }
}
