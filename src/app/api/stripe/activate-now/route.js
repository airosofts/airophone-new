// Ends the trial immediately and activates the paid subscription now
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

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

    console.log(`[activate-now] Trial ended immediately for workspace ${workspaceId}, new status: ${updated.status}`)

    return NextResponse.json({ success: true, status: updated.status })
  } catch (error) {
    console.error('[activate-now] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to activate' }, { status: 500 })
  }
}
