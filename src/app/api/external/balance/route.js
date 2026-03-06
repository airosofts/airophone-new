import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { validateApiKey } from '@/lib/api-key-auth'

/**
 * GET /api/external/balance
 *
 * Returns the credit balance for the workspace associated with the API key.
 * Lets smsablemantool/smsserver check credits before starting a campaign.
 *
 * Headers:
 *   Authorization: Bearer airo_live_<key>
 *
 * Response:
 *   { credits: 1250, workspaceId: "uuid" }
 */
export async function GET(request) {
  const auth = await validateApiKey(request.headers.get('authorization'))
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized — invalid or missing API key' }, { status: 401 })
  }

  const { userId, workspaceId } = auth

  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('credits')
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('[external/balance] Wallet fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 })
  }

  return NextResponse.json({
    credits: Math.floor(wallet?.credits ?? 0),
    workspaceId
  })
}
