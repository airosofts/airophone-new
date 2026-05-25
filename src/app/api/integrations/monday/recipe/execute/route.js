// Monday Integration Recipe — action executor.
//
// monday.com posts here when a user has the recipe
//   "When <some trigger>, send an AiroPhone SMS to {Phone column} from {AiroPhone number} saying {Message}"
// on one of their boards and that trigger fires. We resolve the monday
// accountId → AiroPhone workspace, fetch the item from monday, render the
// message, and send the SMS through Telnyx.
//
// The request body shape (per Monday docs):
//   {
//     "payload": {
//       "inputFields": {
//         "boardId":         123,
//         "itemId":          456,
//         "phoneColumnId":   "phone",
//         "senderNumberId":  "<uuid in our DB>",
//         "messageTemplate": "Hi {pulse.name}, ..."
//       },
//       "recipeId":      "...",
//       "integrationId": "..."
//     }
//   }
//
// On success we return 200 with `{ ok: true }`. On user-side errors (no
// connected workspace, missing phone, no credits, etc.) we still 200 — Monday
// retries 4xx/5xx aggressively, and a logical "couldn't send" is not a transport
// failure. We log instead and surface the outcome through monday_automation_sends.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import {
  getItem, listColumns, extractPhone, columnTitleToPlaceholder,
} from '@/lib/monday'
import {
  withRecipeAuth, workspaceForMondayAccount, extractInputFields, extractIds,
} from '@/lib/monday-recipe'

// ---------------------------------------------------------------------------
// Message rendering — supports both Monday's {pulse.<col>} and our own
// {{column_slug}} substitution. We expose both so users coming from monday
// recipes can use the syntax they already know.
function renderMessage(template, item, columns) {
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

export const POST = withRecipeAuth(async (request, { payload, body }) => {
  const accountId = payload.accountId || payload.account_id
  const fields = extractInputFields(body)
  const ids = extractIds(body)

  console.log('[monday-recipe/execute] inbound', {
    accountId,
    integrationId: ids.integrationId,
    recipeId: ids.recipeId,
    boardId: fields.boardId,
    itemId: fields.itemId,
  })

  const workspaceId = await workspaceForMondayAccount(accountId)
  if (!workspaceId) {
    console.warn('[monday-recipe/execute] no AiroPhone workspace linked to monday account', accountId)
    // 200 — there's nothing for monday to retry. Surface in our logs only.
    return NextResponse.json({ ok: true, skipped: 'workspace_not_connected' })
  }

  const { boardId, itemId, phoneColumnId, senderNumberId, messageTemplate } = fields
  if (!boardId || !itemId || !phoneColumnId || !senderNumberId) {
    console.warn('[monday-recipe/execute] missing required input fields', fields)
    return NextResponse.json({ ok: true, skipped: 'missing_input' })
  }

  // Dedup on (integrationId, itemId) — the same lead shouldn't get pinged
  // twice if monday redelivers the action. Falls back to (workspace + item)
  // when integrationId is absent (it always should be present in prod).
  const dedupKey = ids.integrationId || `ws:${workspaceId}`
  const { error: claimErr } = await supabaseAdmin
    .from('monday_recipe_runs')
    .insert({
      integration_id:   dedupKey,
      monday_item_id:   String(itemId),
      monday_board_id:  String(boardId),
      workspace_id:     workspaceId,
      status:           'pending',
    })
  if (claimErr && claimErr.code !== '23505') {
    console.error('[monday-recipe/execute] dedup claim error:', claimErr)
    // fall through — better to send twice than zero times if our table is down
  } else if (claimErr?.code === '23505') {
    console.log('[monday-recipe/execute] already ran for this item — skipping')
    return NextResponse.json({ ok: true, skipped: 'duplicate' })
  }

  // Sender number — owned by this workspace (defense in depth: the dropdown
  // already filtered by workspace, but never trust the client).
  const { data: sender } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, phone_number, workspace_id')
    .eq('id', senderNumberId)
    .maybeSingle()
  if (!sender || sender.workspace_id !== workspaceId) {
    await markRun(dedupKey, itemId, 'failed', 'Sender number not owned by workspace')
    return NextResponse.json({ ok: true, skipped: 'sender_not_owned' })
  }

  // Fetch item + columns from monday using the workspace's stored OAuth token.
  let item, columns
  try {
    ;[item, columns] = await Promise.all([
      getItem(workspaceId, itemId),
      listColumns(workspaceId, boardId),
    ])
  } catch (err) {
    console.error('[monday-recipe/execute] monday fetch failed:', err.message)
    await markRun(dedupKey, itemId, 'failed', `Monday fetch failed: ${err.message}`)
    return NextResponse.json({ ok: true, skipped: 'monday_fetch_failed' })
  }
  if (!item) {
    await markRun(dedupKey, itemId, 'failed', 'Item not found')
    return NextResponse.json({ ok: true, skipped: 'item_not_found' })
  }

  // Lead phone — may not be filled yet on a brand-new item. In that case the
  // run is marked 'pending' and the sweeper retries; same playbook as the
  // legacy webhook automation.
  const phoneCv = (item.column_values || []).find(cv => cv.id === phoneColumnId)
  const leadPhone = normalizePhoneNumber(extractPhone(phoneCv))
  if (!leadPhone) {
    await markRun(dedupKey, itemId, 'pending', 'Phone column not filled yet')
    return NextResponse.json({ ok: true, status: 'pending' })
  }

  const messageText = renderMessage(messageTemplate, item, columns).trim()
  if (!messageText) {
    await markRun(dedupKey, itemId, 'failed', 'Empty message')
    return NextResponse.json({ ok: true, skipped: 'empty_message' })
  }

  const fromNumber = normalizePhoneNumber(sender.phone_number)
  const result = await telnyx.sendMessage(fromNumber, leadPhone, messageText)
  if (!result.success) {
    await markRun(dedupKey, itemId, 'failed', 'Telnyx send failed')
    return NextResponse.json({ ok: true, skipped: 'telnyx_failed' })
  }

  // Get-or-create conversation so the reply lands in the right inbox.
  const conversation = await getOrCreateConversation({
    workspaceId,
    fromNumber,
    leadPhone,
    leadName: item.name,
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

  await markRun(dedupKey, itemId, 'sent', null, {
    conversation_id: conversation.id,
    message_id:      result.messageId || null,
  })

  console.log('[monday-recipe/execute] sent', {
    workspaceId, itemId, conversation: conversation.id,
  })
  return NextResponse.json({ ok: true, status: 'sent' })
})

// ── helpers ────────────────────────────────────────────────────────────────

async function markRun(integrationId, itemId, status, detail, extras = {}) {
  await supabaseAdmin
    .from('monday_recipe_runs')
    .update({ status, detail, ...extras, updated_at: new Date().toISOString() })
    .eq('integration_id', integrationId)
    .eq('monday_item_id', String(itemId))
}

async function getOrCreateConversation({ workspaceId, fromNumber, leadPhone, leadName }) {
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
