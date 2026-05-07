// Ends the trial immediately and activates the paid subscription now
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function qualifyReferral(workspaceId, stripeSubscriptionId) {
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

    const commission = settings?.enabled ? Number(settings.commission_value) : 0
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

export async function POST(request) {
  try {
    const workspaceId = request.headers.get('x-workspace-id')
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get the active subscription for this workspace
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
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
    })

    // Update local DB status
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: updated.status, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.stripe_subscription_id)

    console.log(`[activate-now] Trial ended for workspace ${workspaceId}, status: ${updated.status}`)

    // Qualify referral immediately if subscription is now active.
    // The Stripe webhook does this too, but webhook delivery can be delayed or missed.
    if (updated.status === 'active') {
      await qualifyReferral(workspaceId, sub.stripe_subscription_id)
    }

    return NextResponse.json({ success: true, status: updated.status })
  } catch (error) {
    console.error('[activate-now] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to activate' }, { status: 500 })
  }
}
