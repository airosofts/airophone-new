import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLAN_CREDITS = { starter: 200, growth: 500, enterprise: 1000 }
const PRICE_TO_PLAN = {
  [process.env.STRIPE_STARTER_PRICE_ID]: 'starter',
  [process.env.STRIPE_GROWTH_PRICE_ID]: 'growth',
  [process.env.STRIPE_ENTERPRISE_PRICE_ID]: 'enterprise',
}

export async function POST(request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_TEST

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object
        const priceId = sub.items.data[0]?.price?.id
        const planName = PRICE_TO_PLAN[priceId] || 'starter'

        // Find workspace by stripe customer
        const { data: sc } = await supabaseAdmin
          .from('stripe_customers')
          .select('user_id, workspace_id')
          .eq('stripe_customer_id', sub.customer)
          .single()
        if (!sc) break

        // Upsert subscription record
        await supabaseAdmin.from('subscriptions').upsert({
          user_id: sc.user_id,
          workspace_id: sc.workspace_id,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          plan_name: planName,
          price_id: priceId,
          status: sub.status,
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'stripe_subscription_id' })

        // Update workspace plan
        await supabaseAdmin.from('workspaces')
          .update({ plan_name: planName, plan_status: sub.status, updated_at: new Date().toISOString() })
          .eq('id', sc.workspace_id)
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object
        if (invoice.billing_reason !== 'subscription_cycle') break

        const { data: sc } = await supabaseAdmin
          .from('stripe_customers')
          .select('user_id, workspace_id')
          .eq('stripe_customer_id', invoice.customer)
          .single()
        if (!sc) break

        // Get current plan
        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('plan_name')
          .eq('workspace_id', sc.workspace_id)
          .single()

        const planCredits = PLAN_CREDITS[sub?.plan_name || 'starter']

        // Add monthly credits to wallet
        const { data: wallet } = await supabaseAdmin
          .from('wallets')
          .select('id, credits')
          .eq('workspace_id', sc.workspace_id)
          .single()

        if (wallet) {
          // Reset to plan credits each month — purchased extra credits are separate
          await supabaseAdmin.from('wallets')
            .update({ credits: planCredits, updated_at: new Date().toISOString() })
            .eq('id', wallet.id)

          await supabaseAdmin.from('transactions').insert({
            workspace_id: sc.workspace_id,
            type: 'topup',
            credits: planCredits,
            amount: invoice.amount_paid / 100,
            currency: 'USD',
            description: `Monthly ${sub?.plan_name || 'starter'} plan renewal — ${planCredits} credits`,
            status: 'completed',
          })
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const { data: sc } = await supabaseAdmin
          .from('stripe_customers')
          .select('workspace_id')
          .eq('stripe_customer_id', sub.customer)
          .single()
        if (!sc) break

        await supabaseAdmin.from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id)

        await supabaseAdmin.from('workspaces')
          .update({ plan_name: null, plan_status: 'canceled', updated_at: new Date().toISOString() })
          .eq('id', sc.workspace_id)

        // Zero out credits immediately — prevent abuse after cancellation
        await supabaseAdmin.from('wallets')
          .update({ credits: 0, updated_at: new Date().toISOString() })
          .eq('workspace_id', sc.workspace_id)

        await supabaseAdmin.from('transactions').insert({
          workspace_id: sc.workspace_id,
          type: 'adjustment',
          credits: 0,
          amount: 0,
          currency: 'USD',
          description: 'Credits zeroed — subscription canceled',
          status: 'completed',
        })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const { data: sc } = await supabaseAdmin
          .from('stripe_customers')
          .select('workspace_id')
          .eq('stripe_customer_id', invoice.customer)
          .single()
        if (!sc) break

        // Mark subscription and workspace as past_due
        await supabaseAdmin.from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', invoice.customer)
          .in('status', ['active', 'trialing'])

        await supabaseAdmin.from('workspaces')
          .update({ plan_status: 'past_due', updated_at: new Date().toISOString() })
          .eq('id', sc.workspace_id)

        // Zero out credits for past_due — they haven't paid
        await supabaseAdmin.from('wallets')
          .update({ credits: 0, updated_at: new Date().toISOString() })
          .eq('workspace_id', sc.workspace_id)
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[webhook] Handler error:', error)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}
