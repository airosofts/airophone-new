// Monday Integration Recipe — custom field type: "AiroPhone sender number".
//
// When the user builds the recipe in monday and reaches the "From which
// AiroPhone number?" dropdown, monday calls this endpoint and renders the
// returned list as options.
//
// Required response shape (per Monday docs):
//   [ { title: "<label>", value: "<id>" }, ... ]
//
// Auth comes from the same MONDAY_SIGNING_SECRET JWT used everywhere else.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { withRecipeAuth, workspaceForMondayAccount } from '@/lib/monday-recipe'

export const POST = withRecipeAuth(async (request, { payload }) => {
  const accountId = payload.accountId || payload.account_id
  const workspaceId = await workspaceForMondayAccount(accountId)

  if (!workspaceId) {
    // No connected workspace — return one synthetic option that tells the user
    // what to do. Monday will display it; if they pick it, the execute call
    // will skip with `workspace_not_connected` (also surfaced in our logs).
    return NextResponse.json([
      { title: 'Connect AiroPhone first → app.airophone.com', value: 'not_connected' },
    ])
  }

  const { data: numbers, error } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, phone_number, custom_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[monday-recipe/sender-numbers] db error:', error)
    return NextResponse.json([])
  }

  const options = (numbers || []).map(n => ({
    title: n.custom_name ? `${n.custom_name} (${n.phone_number})` : n.phone_number,
    value: n.id,
  }))

  // Empty list — give the user a hint instead of a silent empty dropdown.
  if (options.length === 0) {
    return NextResponse.json([
      { title: 'No AiroPhone numbers yet → buy one at app.airophone.com', value: 'no_numbers' },
    ])
  }

  return NextResponse.json(options)
})
