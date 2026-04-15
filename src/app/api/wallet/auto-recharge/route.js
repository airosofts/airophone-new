import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLAN_OVERAGE = { starter: 0.04, growth: 0.03, enterprise: 0.02 }

// GET — fetch auto-recharge settings
export async function GET(request) {
  const workspaceId = request.headers.get('x-workspace-id')
  if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: ws } = await supabaseAdmin
    .from('workspaces')
    .select('auto_recharge_enabled, auto_recharge_threshold, auto_recharge_amount')
    .eq('id', workspaceId)
    .single()

  return NextResponse.json({
    success: true,
    enabled: ws?.auto_recharge_enabled ?? false,
    threshold: ws?.auto_recharge_threshold ?? 50,
    amount: ws?.auto_recharge_amount ?? 200,
  })
}

// PUT — save auto-recharge settings
export async function PUT(request) {
  const workspaceId = request.headers.get('x-workspace-id')
  if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { enabled, threshold, amount } = await request.json()

  if (threshold < 1 || amount < 1) {
    return NextResponse.json({ error: 'Threshold and amount must be at least 1' }, { status: 400 })
  }

  await supabaseAdmin
    .from('workspaces')
    .update({
      auto_recharge_enabled: !!enabled,
      auto_recharge_threshold: parseInt(threshold),
      auto_recharge_amount: parseInt(amount),
      updated_at: new Date().toISOString(),
    })
    .eq('id', workspaceId)

  return NextResponse.json({ success: true })
}

// POST — trigger auto-recharge check (called after credit deduction)
export async function POST(request) {
  const workspaceId = request.headers.get('x-workspace-id')
  const userId = request.headers.get('x-user-id')
  if (!workspaceId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Get workspace settings + current credits
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('auto_recharge_enabled, auto_recharge_threshold, auto_recharge_amount, plan_name')
      .eq('id', workspaceId)
      .single()

    if (!ws?.auto_recharge_enabled) return NextResponse.json({ triggered: false, reason: 'disabled' })

    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id, credits')
      .eq('user_id', userId)
      .single()

    if (!wallet) return NextResponse.json({ triggered: false, reason: 'no_wallet' })

    const currentCredits = parseFloat(wallet.credits) || 0
    if (currentCredits >= ws.auto_recharge_threshold) {
      return NextResponse.json({ triggered: false, reason: 'above_threshold', credits: currentCredits })
    }

    // Get default payment method
    const { data: pm } = await supabaseAdmin
      .from('payment_methods')
      .select('stripe_payment_method_id, stripe_customer_id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single()

    if (!pm) return NextResponse.json({ triggered: false, reason: 'no_payment_method' })

    const overage = PLAN_OVERAGE[ws.plan_name] || 0.04
    const buyAmount = parseInt(ws.auto_recharge_amount)
    const dollarAmount = parseFloat((buyAmount * overage).toFixed(2))

    // Charge Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(dollarAmount * 100),
      currency: 'usd',
      customer: pm.stripe_customer_id,
      payment_method: pm.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: { workspace_id: workspaceId, user_id: userId, type: 'auto_recharge', credits: buyAmount.toString() },
    })

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json({ triggered: true, success: false, reason: 'payment_failed' })
    }

    // Add credits
    await supabaseAdmin
      .from('wallets')
      .update({ credits: wallet.credits + buyAmount, updated_at: new Date().toISOString() })
      .eq('id', wallet.id)

    await supabaseAdmin.from('transactions').insert({
      workspace_id: workspaceId,
      type: 'topup',
      credits: buyAmount,
      amount: dollarAmount,
      currency: 'USD',
      description: `Auto-recharge: ${buyAmount} credits ($${dollarAmount.toFixed(2)})`,
      status: 'completed',
    })

    return NextResponse.json({ triggered: true, success: true, credits_added: buyAmount, amount_charged: dollarAmount })
  } catch (error) {
    console.error('[auto-recharge] Error:', error)
    return NextResponse.json({ triggered: true, success: false, error: error.message }, { status: 500 })
  }
}
