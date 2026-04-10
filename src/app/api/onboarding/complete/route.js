import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { selected_plan, credit_amount, rate_per_credit, total_charge, auto_recharge, payment_method_id, cardholder_name } = await request.json()

    if (!payment_method_id || !cardholder_name) {
      return NextResponse.json({ error: 'Payment method and cardholder name are required' }, { status: 400 })
    }

    // Get user info
    const { data: userData } = await supabaseAdmin.from('users').select('email, name').eq('id', userId).single()

    // Get or create Stripe customer
    let stripeCustomerId
    const { data: existingCustomer } = await supabaseAdmin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    if (existingCustomer) {
      stripeCustomerId = existingCustomer.stripe_customer_id
    } else {
      const customer = await stripe.customers.create({
        email: userData?.email,
        name: userData?.name,
        metadata: { user_id: userId, workspace_id: workspaceId },
      })
      stripeCustomerId = customer.id

      await supabaseAdmin.from('stripe_customers').insert({
        user_id: userId,
        workspace_id: workspaceId,
        stripe_customer_id: stripeCustomerId,
      })
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(payment_method_id, { customer: stripeCustomerId })
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: payment_method_id },
    })

    // Get payment method details for storage
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id)

    // Save card in payment_methods table
    // Check if user has any existing default cards
    const { data: existingCards } = await supabaseAdmin
      .from('payment_methods')
      .select('id')
      .eq('user_id', userId)

    const isDefault = !existingCards || existingCards.length === 0

    await supabaseAdmin.from('payment_methods').insert({
      user_id: userId,
      stripe_payment_method_id: payment_method_id,
      stripe_customer_id: stripeCustomerId,
      card_brand: paymentMethod.card?.brand || 'unknown',
      card_last4: paymentMethod.card?.last4 || '****',
      card_exp_month: paymentMethod.card?.exp_month,
      card_exp_year: paymentMethod.card?.exp_year,
      cardholder_name: cardholder_name,
      is_default: isDefault,
    })

    // Add 50 free trial credits to wallet
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id, credits')
      .eq('workspace_id', workspaceId)
      .single()

    if (wallet) {
      await supabaseAdmin
        .from('wallets')
        .update({ credits: wallet.credits + 50, updated_at: new Date().toISOString() })
        .eq('id', wallet.id)

      // Record the transaction
      await supabaseAdmin.from('transactions').insert({
        workspace_id: workspaceId,
        type: 'topup',
        credits: 50,
        amount: 0,
        currency: 'USD',
        description: 'Free trial credits',
        status: 'completed',
      })
    }

    // Save plan + auto-recharge setting on the workspace
    await supabaseAdmin
      .from('workspaces')
      .update({
        settings: {
          selected_plan: selected_plan || 'growth',
          credit_amount: credit_amount || 500,
          rate_per_credit: rate_per_credit || 0.025,
          recharge_amount: total_charge || '12.50',
          auto_recharge: auto_recharge !== false,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', workspaceId)

    // Mark onboarding as completed
    await supabaseAdmin
      .from('onboarding_profiles')
      .update({
        selected_plan: selected_plan || 'growth',
        card_added: true,
        onboarding_completed: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Onboarding complete error:', error)
    return NextResponse.json({ error: error.message || 'Failed to complete setup' }, { status: 500 })
  }
}
