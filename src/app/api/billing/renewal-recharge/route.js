// POST /api/billing/renewal-recharge  (called by the phone-billing cron, Bearer CRON_SECRET)
//
// When the monthly phone-number renewal can't be paid from the credit wallet,
// the cron calls this to auto-recharge: charge the workspace's default card for a
// credit pack and add it to the wallet, so the number can renew instead of being
// recycled. Gated by workspaces.phone_auto_renew (default on) + a saved card.
//
// Body: { workspaceId, creditsNeeded }  →  { recharged, added?, balance?, reason? }

import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// $ per credit by plan (mirrors /api/wallet/auto-recharge).
const PLAN_OVERAGE = { starter: 0.04, growth: 0.03, enterprise: 0.02 }
const MIN_PACK = 200   // buy at least this many credits per charge (covers 2 renewals)

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, creditsNeeded } = await request.json().catch(() => ({}))
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('phone_auto_renew, plan_name')
      .eq('id', workspaceId)
      .single()

    if (!ws) return NextResponse.json({ recharged: false, reason: 'no_workspace' })
    if (ws.phone_auto_renew === false) return NextResponse.json({ recharged: false, reason: 'disabled' })

    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id, credits, user_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!wallet) return NextResponse.json({ recharged: false, reason: 'no_wallet' })

    // Default card belongs to the wallet owner.
    const { data: pm } = await supabaseAdmin
      .from('payment_methods')
      .select('stripe_payment_method_id, stripe_customer_id')
      .eq('user_id', wallet.user_id)
      .eq('is_default', true)
      .maybeSingle()
    if (!pm) return NextResponse.json({ recharged: false, reason: 'no_payment_method' })

    const buyCredits = Math.max(MIN_PACK, Number(creditsNeeded) || 0)
    const rate = PLAN_OVERAGE[ws.plan_name] || 0.04
    const dollarAmount = parseFloat((buyCredits * rate).toFixed(2))

    // Charge the saved card off-session.
    let paymentIntent
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(dollarAmount * 100),
        currency: 'usd',
        customer: pm.stripe_customer_id,
        payment_method: pm.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: { workspace_id: workspaceId, user_id: wallet.user_id, type: 'phone_renewal_recharge', credits: String(buyCredits) },
      })
    } catch (err) {
      // Card declined / expired / needs authentication.
      console.error('[renewal-recharge] charge failed:', err.message)
      return NextResponse.json({ recharged: false, reason: 'charge_declined', error: err.message })
    }

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json({ recharged: false, reason: 'charge_incomplete', status: paymentIntent.status })
    }

    // Add credits + log the top-up.
    const newBalance = Number(wallet.credits || 0) + buyCredits
    await supabaseAdmin
      .from('wallets')
      .update({ credits: newBalance, updated_at: new Date().toISOString() })
      .eq('id', wallet.id)

    await supabaseAdmin.from('transactions').insert({
      workspace_id: workspaceId,
      user_id: wallet.user_id,
      type: 'topup',
      credits: buyCredits,
      amount: dollarAmount,
      currency: 'USD',
      description: `Auto-recharge to renew phone number — ${buyCredits} credits ($${dollarAmount.toFixed(2)})`,
      status: 'completed',
    })

    return NextResponse.json({ recharged: true, added: buyCredits, balance: newBalance, charged: dollarAmount })
  } catch (error) {
    console.error('[renewal-recharge] error:', error)
    return NextResponse.json({ recharged: false, reason: 'error', error: error.message }, { status: 500 })
  }
}
