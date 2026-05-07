import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLAN_CREDITS = { starter: 200, growth: 500, enterprise: 1000 }
const PLAN_PRICES  = { starter: 9,   growth: 29,  enterprise: 59   }
const PRICE_TO_PLAN = {
  [process.env.STRIPE_STARTER_PRICE_ID]: 'starter',
  [process.env.STRIPE_GROWTH_PRICE_ID]: 'growth',
  [process.env.STRIPE_ENTERPRISE_PRICE_ID]: 'enterprise',
}

function calcCommission(settings, planName) {
  if (!settings?.enabled) return 0
  const val = Number(settings.commission_value)
  if (settings.commission_type === 'percent') {
    return (PLAN_PRICES[planName] || 29) * val / 100
  }
  return val
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

        // Qualify referral when workspace first becomes a paid subscriber
        if (sub.status === 'active') {
          const { data: referral } = await supabaseAdmin
            .from('referrals')
            .select('id, referrer_workspace_id')
            .eq('referred_workspace_id', sc.workspace_id)
            .eq('status', 'pending')
            .maybeSingle()

          if (referral) {
            const { data: settings } = await supabaseAdmin
              .from('referral_settings')
              .select('enabled, commission_type, commission_value')
              .single()

            const commission = calcCommission(settings, planName)

            if (commission > 0) {
              await supabaseAdmin.from('referrals').update({
                status: 'qualified',
                commission_amount: commission,
                stripe_subscription_id: sub.id,
                qualified_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }).eq('id', referral.id)

              // Upsert referrer balance
              const { data: bal } = await supabaseAdmin
                .from('referral_balances')
                .select('id, balance, lifetime_earned')
                .eq('workspace_id', referral.referrer_workspace_id)
                .single()

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
            }
          }
        }
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

        // Queue workspace phone numbers for recycling (quarantine for 30 days)
        const quarantineUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data: wsNumbers } = await supabaseAdmin
          .from('phone_numbers')
          .select('phone_number, messaging_profile_id')
          .eq('workspace_id', sc.workspace_id)
          .eq('is_active', true)

        if (wsNumbers?.length) {
          // Delete Telnyx messaging profile
          const profileId = wsNumbers[0]?.messaging_profile_id
          if (profileId) {
            await fetch(`https://api.telnyx.com/v2/messaging_profiles/${profileId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
            }).catch(() => {})
          }

          for (const n of wsNumbers) {
            // Check if already in pool; update or insert to avoid partial-index upsert conflict
            const { data: existing } = await supabaseAdmin
              .from('recycled_numbers')
              .select('id')
              .eq('phone_number', n.phone_number)
              .not('status', 'eq', 'assigned')
              .maybeSingle()

            if (existing) {
              await supabaseAdmin.from('recycled_numbers').update({
                status: 'quarantine',
                quarantine_until: quarantineUntil,
                original_workspace_id: sc.workspace_id,
                telnyx_messaging_profile_id: n.messaging_profile_id,
                updated_at: new Date().toISOString(),
              }).eq('id', existing.id)
            } else {
              await supabaseAdmin.from('recycled_numbers').insert({
                phone_number: n.phone_number,
                original_workspace_id: sc.workspace_id,
                telnyx_messaging_profile_id: n.messaging_profile_id,
                status: 'quarantine',
                quarantine_until: quarantineUntil,
                entered_cycle_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
            }
          }
        }
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

        // Track/escalate phone numbers based on how long payment has been failing
        const { data: wsNumbers } = await supabaseAdmin
          .from('phone_numbers')
          .select('phone_number, messaging_profile_id')
          .eq('workspace_id', sc.workspace_id)
          .eq('is_active', true)

        if (wsNumbers?.length) {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          const quarantineUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          const profileIdsToDelete = new Set()

          for (const n of wsNumbers) {
            const { data: existing } = await supabaseAdmin
              .from('recycled_numbers')
              .select('id, status, failed_payment_at')
              .eq('phone_number', n.phone_number)
              .not('status', 'eq', 'assigned')
              .maybeSingle()

            if (!existing) {
              // First payment failure — track as pending, give user 7 days
              await supabaseAdmin.from('recycled_numbers').insert({
                phone_number: n.phone_number,
                original_workspace_id: sc.workspace_id,
                telnyx_messaging_profile_id: n.messaging_profile_id,
                status: 'pending',
                failed_payment_at: new Date().toISOString(),
                entered_cycle_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
            } else if (existing.status === 'pending' && existing.failed_payment_at < sevenDaysAgo) {
              // 7+ days of failed payment — escalate to quarantine
              await supabaseAdmin.from('recycled_numbers').update({
                status: 'quarantine',
                quarantine_until: quarantineUntil,
                updated_at: new Date().toISOString(),
              }).eq('id', existing.id)

              // Deactivate the number — it's no longer usable
              await supabaseAdmin.from('phone_numbers')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('phone_number', n.phone_number)
                .eq('workspace_id', sc.workspace_id)

              if (n.messaging_profile_id) profileIdsToDelete.add(n.messaging_profile_id)
            }
          }

          // Delete Telnyx messaging profiles for newly quarantined numbers
          for (const profileId of profileIdsToDelete) {
            await fetch(`https://api.telnyx.com/v2/messaging_profiles/${profileId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
            }).catch(() => {})
          }
        }
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[webhook] Handler error:', error)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}
