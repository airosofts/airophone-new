import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLAN_CREDITS = { starter: 200, growth: 500, enterprise: 1000 }

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan_name, price_id, payment_method_id, cardholder_name, coupon_id } = await request.json()

    if (!payment_method_id || !cardholder_name) {
      return NextResponse.json({ error: 'Payment method and cardholder name are required' }, { status: 400 })
    }

    if (!plan_name || !price_id) {
      return NextResponse.json({ error: 'Plan name and price ID are required' }, { status: 400 })
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

    // Attach payment method to customer and set as default
    await stripe.paymentMethods.attach(payment_method_id, { customer: stripeCustomerId })
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: payment_method_id },
    })

    // Get payment method details for storage
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id)

    // Save card in payment_methods table
    const { data: existingCards } = await supabaseAdmin
      .from('payment_methods')
      .select('id')
      .eq('user_id', userId)

    const isDefault = !existingCards || existingCards.length === 0

    await supabaseAdmin.from('payment_methods').insert({
      user_id: userId,
      stripe_payment_method_id: payment_method_id,
      stripe_customer_id: stripeCustomerId,
      type: 'card',
      brand: paymentMethod.card?.brand || 'unknown',
      last4: paymentMethod.card?.last4 || '****',
      exp_month: paymentMethod.card?.exp_month,
      exp_year: paymentMethod.card?.exp_year,
      cardholder_name: cardholder_name,
      is_default: isDefault,
    })

    // Resolve coupon if provided
    let stripeCouponId = null
    let couponRecord = null
    if (coupon_id) {
      const { data: coupon } = await supabaseAdmin
        .from('coupons')
        .select('*')
        .eq('id', coupon_id)
        .eq('is_active', true)
        .single()

      if (coupon) {
        couponRecord = coupon
        // Create a one-time Stripe coupon from our coupon data
        const stripeCouponParams = {
          duration: 'once',
          name: coupon.description || coupon.code,
          metadata: { coupon_id: coupon.id, code: coupon.code },
        }
        if (coupon.discount_type === 'percent') {
          stripeCouponParams.percent_off = coupon.discount_value
        } else {
          stripeCouponParams.amount_off = Math.round(coupon.discount_value * 100) // cents
          stripeCouponParams.currency = 'usd'
        }
        const stripeCoupon = await stripe.coupons.create(stripeCouponParams)
        stripeCouponId = stripeCoupon.id
      }
    }

    // Create Stripe subscription with 7-day trial
    const subscriptionParams = {
      customer: stripeCustomerId,
      items: [{ price: price_id }],
      trial_period_days: 7,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: { user_id: userId, workspace_id: workspaceId, plan_name },
    }
    if (stripeCouponId) {
      subscriptionParams.discounts = [{ coupon: stripeCouponId }]
    }
    const subscription = await stripe.subscriptions.create(subscriptionParams)

    // Record coupon redemption
    if (couponRecord) {
      await supabaseAdmin.from('coupon_redemptions').insert({
        coupon_id: couponRecord.id,
        workspace_id: workspaceId,
        user_id: userId,
        stripe_subscription_id: subscription.id,
        discount_type: couponRecord.discount_type,
        discount_value: couponRecord.discount_value,
        redeemed_at: new Date().toISOString(),
      })

      await supabaseAdmin.rpc('increment_coupon_uses', { coupon_id_param: couponRecord.id })
        .catch(() => {
          // Fallback: manual increment if RPC doesn't exist
          return supabaseAdmin
            .from('coupons')
            .update({ uses_count: (couponRecord.uses_count || 0) + 1 })
            .eq('id', couponRecord.id)
        })
    }

    // Save subscription to subscriptions table
    await supabaseAdmin.from('subscriptions').insert({
      user_id: userId,
      workspace_id: workspaceId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: stripeCustomerId,
      plan_name,
      price_id,
      status: subscription.status,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    })

    // Add plan's included credits to wallet
    const planCredits = PLAN_CREDITS[plan_name] ?? 0

    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id, credits')
      .eq('workspace_id', workspaceId)
      .single()

    if (wallet) {
      await supabaseAdmin
        .from('wallets')
        .update({ credits: wallet.credits + planCredits, updated_at: new Date().toISOString() })
        .eq('id', wallet.id)

      await supabaseAdmin.from('transactions').insert({
        workspace_id: workspaceId,
        type: 'topup',
        credits: planCredits,
        amount: 0,
        currency: 'USD',
        description: `Plan credits — ${plan_name} trial`,
        status: 'completed',
      })
    }

    // Update workspace with plan info
    await supabaseAdmin
      .from('workspaces')
      .update({
        plan_name,
        plan_status: 'trialing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', workspaceId)

    // Mark onboarding as completed
    await supabaseAdmin
      .from('onboarding_profiles')
      .update({
        selected_plan: plan_name,
        card_added: true,
        onboarding_completed: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    return NextResponse.json({
      success: true,
      subscription_id: subscription.id,
      plan_name,
      trial_end: subscription.trial_end,
    })
  } catch (error) {
    console.error('Onboarding complete error:', error)
    return NextResponse.json({ error: error.message || 'Failed to complete setup' }, { status: 500 })
  }
}
