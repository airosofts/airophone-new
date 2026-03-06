import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    // Get user and workspace IDs from headers
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    const { amount, payment_method_id, credits } = await request.json()

    // Validate - either amount in dollars or credits must be provided
    if (!amount && !credits) {
      return NextResponse.json(
        { success: false, error: 'Please specify amount or credits' },
        { status: 400 }
      )
    }

    // Calculate credits
    const creditAmount = credits || 0
    const dollarAmount = amount || 0

    console.log(`Processing topup: Credits: ${creditAmount}, User Payment: $${dollarAmount}`)

    // Get payment method from database
    const { data: paymentMethod, error: pmError } = await supabase
      .from('payment_methods')
      .select('stripe_payment_method_id, stripe_customer_id')
      .eq('id', payment_method_id)
      .eq('user_id', userId)
      .single()

    if (pmError || !paymentMethod) {
      return NextResponse.json(
        { success: false, error: 'Payment method not found' },
        { status: 404 }
      )
    }

    // Create payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(dollarAmount * 100), // Convert to cents
      currency: 'usd',
      customer: paymentMethod.stripe_customer_id,
      payment_method: paymentMethod.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: {
        user_id: userId,
        type: 'wallet_topup',
        credits: creditAmount.toString(),
        amount: dollarAmount.toString()
      }
    })

    // Check if payment succeeded
    if (paymentIntent.status === 'succeeded') {
      // Update wallet credits using our database function
      // First try the new function, fallback to old one if it doesn't exist
      let data, walletError
      try {
        const result = await supabase.rpc('update_wallet_credits', {
          p_user_id: userId,
          p_credits: creditAmount,
          p_type: 'topup',
          p_description: `Credit purchase: ${creditAmount} credits ($${dollarAmount.toFixed(2)})`,
          p_payment_method_id: payment_method_id,
          p_stripe_payment_intent_id: paymentIntent.id,
          p_stripe_charge_id: paymentIntent.latest_charge
        })
        data = result.data
        walletError = result.error
      } catch (funcError) {
        // Fallback: directly update the credits column
        console.log('Using direct update method')
        // Upsert by workspace_id (shared wallet) or fall back to user_id
        const upsertData = {
          credits: supabase.raw(`credits + ${creditAmount}`),
          updated_at: new Date().toISOString()
        }
        if (workspaceId) {
          upsertData.workspace_id = workspaceId
        } else {
          upsertData.user_id = userId
        }
        const upsertConflict = workspaceId ? 'workspace_id' : 'user_id'

        const { error: updateError } = await supabase
          .from('wallets')
          .upsert(upsertData, { onConflict: upsertConflict })

        if (!updateError) {
          // Create transaction record
          const txInsert = {
            user_id: userId,
            amount: creditAmount,
            type: 'topup',
            status: 'completed',
            description: `Credit purchase: ${creditAmount} credits ($${dollarAmount.toFixed(2)})`,
            payment_method_id: payment_method_id,
            stripe_payment_intent_id: paymentIntent.id,
            stripe_charge_id: paymentIntent.latest_charge
          }
          if (workspaceId) txInsert.workspace_id = workspaceId

          const { data: txData, error: txError } = await supabase
            .from('wallet_transactions')
            .insert(txInsert)
            .select('id')
            .single()

          data = txData?.id
          walletError = txError
        } else {
          walletError = updateError
        }
      }

      if (walletError) {
        console.error('Wallet update error:', walletError)
        throw walletError
      }

      return NextResponse.json({
        success: true,
        message: 'Credits purchased successfully',
        transaction_id: data,
        credits_purchased: creditAmount,
        amount_paid: dollarAmount,
        new_balance: await getWalletBalance(userId, workspaceId)
      })
    } else {
      return NextResponse.json(
        { success: false, error: 'Payment not completed' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Error topping up wallet:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process payment' },
      { status: 500 }
    )
  }
}

// Helper function to get wallet credits
async function getWalletBalance(userId, workspaceId) {
  const query = supabase.from('wallets').select('credits')
  const { data } = await (workspaceId
    ? query.eq('workspace_id', workspaceId)
    : query.eq('user_id', userId)
  ).single()

  return data ? parseFloat(data.credits) : 0.00
}
