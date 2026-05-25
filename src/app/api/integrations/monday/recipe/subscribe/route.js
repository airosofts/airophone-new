// Monday Integration Recipe — subscribe.
//
// Called once when a user adds a recipe involving our action to one of their
// boards. For a pure *action* (we only send out, we don't listen) this is
// essentially a stateless ack: store the subscription so unsubscribe can find
// it later, and return 200.
//
// For a *custom trigger* we'd register a Monday webhook here and return its
// webhook id — we don't ship that yet, but the table accommodates it.
//
// Request body shape:
//   { payload: { webhookUrl, subscriptionId, integrationId, recipeId,
//                inputFields: { ... }, ... } }

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import {
  withRecipeAuth, workspaceForMondayAccount, extractInputFields, extractIds,
} from '@/lib/monday-recipe'

export const POST = withRecipeAuth(async (request, { payload, body }) => {
  const accountId = payload.accountId || payload.account_id
  const ids = extractIds(body)
  const fields = extractInputFields(body)

  console.log('[monday-recipe/subscribe] inbound', {
    accountId,
    integrationId: ids.integrationId,
    recipeId: ids.recipeId,
    boardId: fields.boardId,
  })

  const workspaceId = await workspaceForMondayAccount(accountId)
  if (!workspaceId) {
    // No connected workspace — the user installed the app but never finished
    // OAuth. Surface as 200 (Monday treats non-200 as "the recipe failed to
    // install") and log; they'll see the error in monday's UI as a no-op.
    console.warn('[monday-recipe/subscribe] no workspace linked to account', accountId)
    return NextResponse.json({})
  }

  await supabaseAdmin
    .from('monday_recipe_subscriptions')
    .upsert(
      {
        integration_id:  ids.integrationId,
        recipe_id:       ids.recipeId,
        workspace_id:    workspaceId,
        monday_board_id: fields.boardId ? String(fields.boardId) : null,
        input_fields:    fields,
        webhook_url:     ids.webhookUrl,
        created_at:      new Date().toISOString(),
      },
      { onConflict: 'integration_id' },
    )

  // Action subscribes have no webhookId to return — empty body is the accepted
  // shape (Monday only checks the 200 status for actions).
  return NextResponse.json({})
})
