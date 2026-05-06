import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = user.workspaceId

  // Get referral code — auto-generate if missing (handles existing workspaces)
  let { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('referral_code')
    .eq('id', workspaceId)
    .single()

  if (!workspace?.referral_code) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase()
      const { data: updated, error } = await supabaseAdmin
        .from('workspaces')
        .update({ referral_code: code })
        .eq('id', workspaceId)
        .select('referral_code')
        .single()
      if (!error && updated?.referral_code) { workspace = updated; break }
    }
  }

  // Get balance
  const { data: balance } = await supabaseAdmin
    .from('referral_balances')
    .select('balance, lifetime_earned, lifetime_withdrawn')
    .eq('workspace_id', workspaceId)
    .single()

  // Get referrals list (most recent first)
  const { data: referrals } = await supabaseAdmin
    .from('referrals')
    .select('id, referred_email, status, commission_amount, qualified_at, created_at')
    .eq('referrer_workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  // Get commission settings so the UI can show per-plan earnings
  const { data: commissionSettings } = await supabaseAdmin
    .from('referral_settings')
    .select('commission_type, commission_value, enabled')
    .single()

  return NextResponse.json({
    referral_code: workspace?.referral_code || null,
    balance: Number(balance?.balance || 0),
    lifetime_earned: Number(balance?.lifetime_earned || 0),
    lifetime_withdrawn: Number(balance?.lifetime_withdrawn || 0),
    referrals: referrals || [],
    commission: commissionSettings || null,
  })
}
