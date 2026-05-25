// Monday Integration Recipe — unsubscribe.
//
// Called when a user removes a recipe from their board (or the whole app is
// uninstalled). Best-effort cleanup of our subscription row; never throw —
// Monday treats non-200 as a retry signal and will hammer the endpoint.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { withRecipeAuth, extractIds } from '@/lib/monday-recipe'

export const POST = withRecipeAuth(async (request, { body }) => {
  const ids = extractIds(body)

  if (!ids.integrationId) {
    return NextResponse.json({})
  }

  await supabaseAdmin
    .from('monday_recipe_subscriptions')
    .delete()
    .eq('integration_id', ids.integrationId)

  console.log('[monday-recipe/unsubscribe] removed', ids.integrationId)
  return NextResponse.json({})
})
