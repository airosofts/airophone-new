import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!sub) return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })

    // Cancel at period end — user keeps access until billing cycle ends
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    })

    await supabaseAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.stripe_subscription_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[cancel-subscription] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to cancel subscription' }, { status: 500 })
  }
}

// Undo cancel — reactivate if they change their mind
export async function DELETE(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('workspace_id', workspaceId)
      .eq('cancel_at_period_end', true)
      .limit(1)
      .single()

    if (!sub) return NextResponse.json({ error: 'No cancellation scheduled' }, { status: 404 })

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    })

    await supabaseAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.stripe_subscription_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[reactivate-subscription] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed to reactivate subscription' }, { status: 500 })
  }
}
