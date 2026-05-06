import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = user.workspaceId
  const body = await request.json()
  const { amount, method, payout_details } = body

  if (!amount || !method || !payout_details) {
    return NextResponse.json({ error: 'amount, method, and payout_details are required' }, { status: 400 })
  }

  if (!['paypal', 'bank'].includes(method)) {
    return NextResponse.json({ error: 'method must be paypal or bank' }, { status: 400 })
  }

  const requestedAmount = Number(amount)
  if (isNaN(requestedAmount) || requestedAmount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }

  // Validate payout details
  if (method === 'paypal' && !payout_details.email) {
    return NextResponse.json({ error: 'PayPal email is required' }, { status: 400 })
  }
  if (method === 'bank' && (!payout_details.bank_name || !payout_details.account_number || !payout_details.routing_number)) {
    return NextResponse.json({ error: 'Bank name, account number, and routing number are required' }, { status: 400 })
  }

  // Check available balance
  const { data: bal } = await supabaseAdmin
    .from('referral_balances')
    .select('id, balance')
    .eq('workspace_id', workspaceId)
    .single()

  const available = Number(bal?.balance || 0)
  if (requestedAmount > available) {
    return NextResponse.json({ error: `Insufficient balance. Available: $${available.toFixed(2)}` }, { status: 400 })
  }

  // Check for a pending withdrawal (only one allowed at a time)
  const { data: pending } = await supabaseAdmin
    .from('referral_withdrawals')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('status', ['pending', 'processing'])
    .limit(1)
    .single()

  if (pending) {
    return NextResponse.json({ error: 'You already have a pending withdrawal request' }, { status: 400 })
  }

  // Deduct from balance and create withdrawal request atomically-ish
  await supabaseAdmin.from('referral_balances').update({
    balance: available - requestedAmount,
    updated_at: new Date().toISOString(),
  }).eq('id', bal.id)

  const { data: withdrawal, error: wErr } = await supabaseAdmin
    .from('referral_withdrawals')
    .insert({
      workspace_id: workspaceId,
      amount: requestedAmount,
      method,
      payout_details,
      status: 'pending',
    })
    .select()
    .single()

  if (wErr) {
    // Rollback balance deduction on insert failure
    await supabaseAdmin.from('referral_balances').update({
      balance: available,
      updated_at: new Date().toISOString(),
    }).eq('id', bal.id)
    return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
  }

  return NextResponse.json({ success: true, withdrawal })
}
