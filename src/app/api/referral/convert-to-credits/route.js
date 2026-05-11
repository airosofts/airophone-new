import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { getWorkspaceMessageRate } from '@/lib/pricing'

// Convert referral balance → wallet credits at the workspace's current overage rate.
// Same value the user would get if they topped up directly with cash, so it's neutral
// for us and feels fair to the user.

const MIN_AMOUNT = 5

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = user.workspaceId
  const body = await request.json().catch(() => ({}))
  const amount = Number(body.amount)

  if (!amount || isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }
  if (amount < MIN_AMOUNT) {
    return NextResponse.json({ error: `Minimum transfer is $${MIN_AMOUNT}` }, { status: 400 })
  }

  // Read current balance
  const { data: bal } = await supabaseAdmin
    .from('referral_balances')
    .select('id, balance')
    .eq('workspace_id', workspaceId)
    .single()

  const available = Number(bal?.balance || 0)
  if (amount > available) {
    return NextResponse.json({ error: `Insufficient balance. Available: $${available.toFixed(2)}` }, { status: 400 })
  }

  // Credits = amount / per-message overage rate (same rate they'd pay buying credits)
  const rate = await getWorkspaceMessageRate(workspaceId)
  if (!rate || rate <= 0) {
    return NextResponse.json({ error: 'Failed to determine credit rate' }, { status: 500 })
  }
  const credits = Math.floor(amount / rate)
  if (credits <= 0) {
    return NextResponse.json({ error: 'Amount too small to convert to credits' }, { status: 400 })
  }

  // 1. Decrement referral balance
  const newBalance = available - amount
  const { error: balErr } = await supabaseAdmin
    .from('referral_balances')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', bal.id)

  if (balErr) {
    console.error('[referral/convert] balance update failed:', balErr)
    return NextResponse.json({ error: 'Failed to update balance' }, { status: 500 })
  }

  // 2. Credit the wallet
  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('id, credits')
    .eq('workspace_id', workspaceId)
    .single()

  if (!wallet) {
    // Roll back the balance deduction
    await supabaseAdmin.from('referral_balances').update({ balance: available, updated_at: new Date().toISOString() }).eq('id', bal.id)
    return NextResponse.json({ error: 'Wallet not found' }, { status: 500 })
  }

  const newCredits = Number(wallet.credits || 0) + credits
  const { error: walletErr } = await supabaseAdmin
    .from('wallets')
    .update({ credits: newCredits, updated_at: new Date().toISOString() })
    .eq('id', wallet.id)

  if (walletErr) {
    // Roll back the balance deduction
    await supabaseAdmin.from('referral_balances').update({ balance: available, updated_at: new Date().toISOString() }).eq('id', bal.id)
    console.error('[referral/convert] wallet update failed:', walletErr)
    return NextResponse.json({ error: 'Failed to credit wallet' }, { status: 500 })
  }

  // 3. Log a transaction so it appears in billing history
  await supabaseAdmin.from('transactions').insert({
    workspace_id: workspaceId,
    user_id: user.userId,
    type: 'topup',
    credits,
    amount,
    currency: 'USD',
    description: `Referral balance → ${credits} credits (rate $${rate}/credit)`,
    status: 'completed',
  })

  return NextResponse.json({
    success: true,
    credits_added: credits,
    rate,
    amount_converted: amount,
    new_balance: newBalance,
    new_credits: newCredits,
  })
}
