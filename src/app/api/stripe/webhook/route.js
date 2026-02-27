import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request) {
  try {
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'No signature found' },
        { status: 400 }
      )
    }

    let event

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return NextResponse.json(
        { error: `Webhook Error: ${err.message}` },
        { status: 400 }
      )
    }

    // Handle the event
    console.log('Received webhook event:', event.type)

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object)
        break

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object)
        break

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object)
        break

      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object)
        break

      case 'payment_method.detached':
        await handlePaymentMethodDetached(event.data.object)
        break

      case 'customer.created':
        await handleCustomerCreated(event.data.object)
        break

      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object)
        break

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object)
        break

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}

// Handle successful payment
async function handlePaymentIntentSucceeded(paymentIntent) {
  console.log('PaymentIntent succeeded:', paymentIntent.id)

  const userId = paymentIntent.metadata?.user_id
  const type = paymentIntent.metadata?.type
  const amount = parseFloat(paymentIntent.metadata?.amount || '0')

  if (!userId || type !== 'wallet_topup') {
    console.log('Not a wallet top-up payment, skipping')
    return
  }

  // Check if transaction already exists
  const { data: existing } = await supabase
    .from('transactions')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

  if (existing) {
    console.log('Transaction already processed')
    return
  }

  // Update wallet balance
  try {
    await supabase.rpc('update_wallet_balance', {
      p_user_id: userId,
      p_amount: amount,
      p_type: 'topup',
      p_description: `Wallet top-up of $${amount.toFixed(2)} via webhook`,
      p_stripe_payment_intent_id: paymentIntent.id,
      p_stripe_charge_id: paymentIntent.latest_charge
    })
    console.log('Wallet updated successfully')
  } catch (error) {
    console.error('Error updating wallet:', error)
  }
}

// Handle failed payment
async function handlePaymentIntentFailed(paymentIntent) {
  console.log('PaymentIntent failed:', paymentIntent.id)

  const userId = paymentIntent.metadata?.user_id

  if (!userId) {
    return
  }

  // Create a failed transaction record
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id, balance')
    .eq('user_id', userId)
    .single()

  if (wallet) {
    await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        wallet_id: wallet.id,
        type: 'topup',
        amount: paymentIntent.amount / 100,
        balance_before: wallet.balance,
        balance_after: wallet.balance,
        description: `Failed wallet top-up - ${paymentIntent.last_payment_error?.message || 'Payment failed'}`,
        status: 'failed',
        stripe_payment_intent_id: paymentIntent.id
      })
  }
}

// Handle refund
async function handleChargeRefunded(charge) {
  console.log('Charge refunded:', charge.id)

  const paymentIntentId = charge.payment_intent

  if (!paymentIntentId) {
    return
  }

  // Find the original transaction
  const { data: transaction } = await supabase
    .from('transactions')
    .select('user_id, amount')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('type', 'topup')
    .single()

  if (!transaction) {
    console.log('Original transaction not found')
    return
  }

  // Create refund transaction
  await supabase.rpc('update_wallet_balance', {
    p_user_id: transaction.user_id,
    p_amount: transaction.amount,
    p_type: 'refund',
    p_description: `Refund for payment ${paymentIntentId.substring(0, 20)}`,
    p_stripe_payment_intent_id: paymentIntentId,
    p_stripe_charge_id: charge.id
  })

  console.log('Refund processed successfully')
}

// Handle payment method attached
async function handlePaymentMethodAttached(paymentMethod) {
  console.log('Payment method attached:', paymentMethod.id)
  // Additional logic if needed
}

// Handle payment method detached
async function handlePaymentMethodDetached(paymentMethod) {
  console.log('Payment method detached:', paymentMethod.id)

  // Remove from database
  await supabase
    .from('payment_methods')
    .delete()
    .eq('stripe_payment_method_id', paymentMethod.id)
}

// Handle customer created
async function handleCustomerCreated(customer) {
  console.log('Customer created:', customer.id)
  // Additional logic if needed
}

// Handle checkout session completed
async function handleCheckoutSessionCompleted(session) {
  console.log('Checkout session completed:', session.id, 'mode:', session.mode)

  const userId = session.metadata?.user_id
  if (!userId) {
    console.log('No user_id in session metadata, skipping')
    return
  }

  // If this was a subscription checkout, the subscription is handled by
  // customer.subscription.created — nothing extra needed here.
  // If one-time payment, log it.
  if (session.mode === 'payment') {
    console.log('One-time payment checkout completed for user:', userId)
  }
}

// Handle subscription created
async function handleSubscriptionCreated(subscription) {
  console.log('Subscription created:', subscription.id, 'status:', subscription.status)

  const customerId = subscription.customer
  if (!customerId) return

  // Look up workspace by stripe customer ID
  const { data: stripeCustomer } = await supabase
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!stripeCustomer) {
    console.log('No user found for customer:', customerId)
    return
  }

  await supabase
    .from('subscriptions')
    .upsert({
      user_id: stripeCustomer.user_id,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      status: subscription.status,
      price_id: subscription.items?.data?.[0]?.price?.id,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    }, { onConflict: 'stripe_subscription_id' })

  console.log('Subscription stored for user:', stripeCustomer.user_id)
}

// Handle subscription updated
async function handleSubscriptionUpdated(subscription) {
  console.log('Subscription updated:', subscription.id, 'status:', subscription.status)

  await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      price_id: subscription.items?.data?.[0]?.price?.id,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
    .eq('stripe_subscription_id', subscription.id)

  console.log('Subscription updated in DB:', subscription.id)
}

// Handle subscription deleted/cancelled
async function handleSubscriptionDeleted(subscription) {
  console.log('Subscription deleted/cancelled:', subscription.id)

  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('stripe_subscription_id', subscription.id)

  console.log('Subscription marked as canceled:', subscription.id)
}

// Disable body parsing for webhooks
export const config = {
  api: {
    bodyParser: false,
  },
}
