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
// failure. We log instead and surface the outcome through monday_recipe_runs.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import {
  withRecipeAuth, workspaceForMondayAccount, extractInputFields, extractIds,
} from '@/lib/monday-recipe'
import { processRecipeRun } from '@/lib/monday-recipe-process'

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
    return NextResponse.json({ ok: true, skipped: 'workspace_not_connected' })
  }

  const { boardId, itemId } = fields
  if (!boardId || !itemId || !fields.phoneColumnId || !fields.senderNumberId) {
    console.warn('[monday-recipe/execute] missing required input fields', fields)
    return NextResponse.json({ ok: true, skipped: 'missing_input' })
  }

  // Dedup on (integrationId, itemId) — same lead shouldn't get pinged twice
  // if monday redelivers the action. Falls back to (workspace + item) when
  // integrationId is absent (it always should be present in prod).
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

  // Stash the recipe inputs on the subscription row keyed by integrationId
  // so the sweeper can retry pending rows without re-receiving monday's
  // signed payload (we don't keep that around).
  if (ids.integrationId) {
    await supabaseAdmin
      .from('monday_recipe_subscriptions')
      .upsert(
        {
          integration_id:  ids.integrationId,
          recipe_id:       ids.recipeId,
          workspace_id:    workspaceId,
          monday_board_id: String(boardId),
          input_fields:    fields,
          created_at:      new Date().toISOString(),
        },
        { onConflict: 'integration_id' },
      )
  }

  const outcome = await processRecipeRun({
    workspaceId,
    boardId,
    itemId,
    inputFields: fields,
  })

  await supabaseAdmin
    .from('monday_recipe_runs')
    .update({
      status: outcome.status,
      detail: outcome.detail || null,
      conversation_id: outcome.conversationId || null,
      message_id: outcome.messageId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('integration_id', dedupKey)
    .eq('monday_item_id', String(itemId))

  console.log(`[monday-recipe/execute] ${outcome.status}`, {
    workspaceId, itemId, detail: outcome.detail,
  })
  return NextResponse.json({ ok: true, status: outcome.status })
})
