// Ends the trial immediately and activates the paid subscription now
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLAN_PRICES = { starter: 9, growth: 29, enterprise: 59 }

function calcCommission(settings, planName) {
  if (!settings?.enabled) return 0
  const val = Number(settings.commission_value)
  if (settings.commission_type === 'percent') {
    return (PLAN_PRICES[planName] || 29) * val / 100
  }
  return val
}

async function qualifyReferral(workspaceId, stripeSubscriptionId, planName) {
  try {
    const { data: referral } = await supabaseAdmin
      .from('referrals')
      .select('id, referrer_workspace_id')
      .eq('referred_workspace_id', workspaceId)
      .eq('status', 'pending')
      .maybeSingle()

    if (!referral) return

    const { data: settings } = await supabaseAdmin
      .from('referral_settings')
      .select('enabled, commission_type, commission_value')
      .single()

    const commission = calcCommission(settings, planName)
    if (commission <= 0) return

    await supabaseAdmin.from('referrals').update({
      status: 'qualified',
      commission_amount: commission,
      stripe_subscription_id: stripeSubscriptionId,
      qualified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', referral.id)

    const { data: bal } = await supabaseAdmin
      .from('referral_balances')
      .select('id, balance, lifetime_earned')
      .eq('workspace_id', referral.referrer_workspace_id)
      .maybeSingle()

    if (bal) {
      await supabaseAdmin.from('referral_balances').update({
        balance: Number(bal.balance) + commission,
        lifetime_earned: Number(bal.lifetime_earned) + commission,
        updated_at: new Date().toISOString(),
      }).eq('id', bal.id)
    } else {
      await supabaseAdmin.from('referral_balances').insert({
        workspace_id: referral.referrer_workspace_id,
        balance: commission,
        lifetime_earned: commission,
        lifetime_withdrawn: 0,
      })
    }

    console.log(`[activate-now] Referral ${referral.id} qualified with commission $${commission}`)
  } catch (err) {
    console.error('[activate-now] Referral qualification failed:', err.message)
  }
}

// Ensure the coupon redemption is recorded in Supabase.
// The onboarding/complete route should have done this, but if it failed
// (e.g. the old .catch() bug, a Supabase error) this acts as a fallback.
async function reconcileCouponRedemption(workspaceId, stripeSubscription) {
  try {
    const discount = stripeSubscription.discount
    if (!discount?.coupon) return

    // We store our internal coupon_id in the Stripe coupon metadata
    const couponId = discount.coupon.metadata?.coupon_id
    if (!couponId) return

    // Check if redemption already recorded for this workspace + coupon
    const { data: existing } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('coupon_id', couponId)
      .maybeSingle()

    if (existing) return // already recorded — nothing to do

    // Fetch the coupon record from Supabase
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('id, discount_type, discount_value, uses_count')
      .eq('id', couponId)
      .maybeSingle()

    if (!coupon) return

    // Get the workspace owner user_id for the redemption record
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()

    await supabaseAdmin.from('coupon_redemptions').insert({
      coupon_id: coupon.id,
      workspace_id: workspaceId,
      user_id: member?.user_id || null,
      stripe_subscription_id: stripeSubscription.id,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      redeemed_at: new Date().toISOString(),
    })

    // Increment uses_count
    try {
      await supabaseAdmin.rpc('increment_coupon_uses', { coupon_id_param: coupon.id })
    } catch {
      await supabaseAdmin
        .from('coupons')
        .update({ uses_count: (coupon.uses_count || 0) + 1 })
        .eq('id', coupon.id)
    }

    console.log(`[activate-now] Coupon redemption recorded for workspace ${workspaceId}, coupon ${coupon.id}`)
  } catch (err) {
    console.error('[activate-now] Coupon reconciliation failed:', err.message)
  }
}

export async function POST(request) {
  try {
    const workspaceId = request.headers.get('x-workspace-id')
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get the active subscription for this workspace
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status, plan_name')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!sub?.stripe_subscription_id) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    if (sub.status !== 'trialing') {
      return NextResponse.json({ error: 'Subscription is not in trial' }, { status: 400 })
    }

    // End trial immediately — Stripe will invoice and charge now
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      trial_end: 'now',
      expand: ['discount'],
    })

    // Update local DB status
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: updated.status, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.stripe_subscription_id)

    console.log(`[activate-now] Trial ended for workspace ${workspaceId}, status: ${updated.status}`)

    // Reconcile coupon redemption — records it in Supabase if missing
    await reconcileCouponRedemption(workspaceId, updated)

    // Qualify referral immediately if subscription is now active.
    // The Stripe webhook does this too, but webhook delivery can be delayed or missed.
    if (updated.status === 'active') {
      await qualifyReferral(workspaceId, sub.stripe_subscription_id, sub.plan_name || 'growth')
    }

    return NextResponse.json({ success: true, status: updated.status })
  } catch (error) {
    console.error('[activate-now] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to activate' }, { status: 500 })
  }
}
