import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET - Fetch all payment methods for user
export async function GET(request) {
  try {
    // Get user ID from header
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({
      success: true,
      cards: data || []
    })
  } catch (error) {
    console.error('Error fetching payment methods:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// POST - Add new payment method
export async function POST(request) {
  try {
    // Get user ID from header
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    // Get user email from database
    const { data: userData } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', userId)
      .single()

    const userEmail = userData?.email || ''

    const { payment_method_id, cardholder_name } = await request.json()

    // Validate input
    if (!payment_method_id || !cardholder_name) {
      return NextResponse.json(
        { success: false, error: 'Payment method ID and cardholder name are required' },
        { status: 400 }
      )
    }

    // Get payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id)

    // Check if user already has a Stripe customer ID
    let stripeCustomerId
    const { data: existingCustomer } = await supabase
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    if (existingCustomer) {
      stripeCustomerId = existingCustomer.stripe_customer_id
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: userEmail,
        name: cardholder_name,
        metadata: {
          user_id: userId
        }
      })
      stripeCustomerId = customer.id

      // Save customer ID to database
      await supabase
        .from('stripe_customers')
        .insert({
          user_id: userId,
          stripe_customer_id: stripeCustomerId,
          email: userEmail,
          name: cardholder_name
        })
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(payment_method_id, {
      customer: stripeCustomerId
    })

    // Check if this is the first payment method
    const { data: existingMethods } = await supabase
      .from('payment_methods')
      .select('id')
      .eq('user_id', userId)
      .limit(1)

    const isFirstCard = !existingMethods || existingMethods.length === 0

    // Save to database
    const { data: savedCard, error: dbError } = await supabase
      .from('payment_methods')
      .insert({
        user_id: userId,
        stripe_payment_method_id: paymentMethod.id,
        stripe_customer_id: stripeCustomerId,
        type: 'card',
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        exp_month: paymentMethod.card.exp_month,
        exp_year: paymentMethod.card.exp_year,
        cardholder_name: cardholder_name,
        is_default: isFirstCard, // First card is default
        billing_details: paymentMethod.billing_details
      })
      .select()
      .single()

    if (dbError) throw dbError

    // If this is the first card, set as default in Stripe too
    if (isFirstCard) {
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethod.id
        }
      })
    }

    return NextResponse.json({
      success: true,
      card: savedCard,
      message: 'Payment method added successfully'
    })
  } catch (error) {
    console.error('Error adding payment method:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to add payment method' },
      { status: 500 }
    )
  }
}

// DELETE - Remove payment method
export async function DELETE(request) {
  try {
    // Get user ID from header
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const paymentMethodId = searchParams.get('id')

    if (!paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'Payment method ID is required' },
        { status: 400 }
      )
    }

    // Get payment method from database
    const { data: paymentMethod, error: fetchError } = await supabase
      .from('payment_methods')
      .select('stripe_payment_method_id')
      .eq('id', paymentMethodId)
      .eq('user_id', userId)
      .single()

    if (fetchError || !paymentMethod) {
      return NextResponse.json(
        { success: false, error: 'Payment method not found' },
        { status: 404 }
      )
    }

    // Detach from Stripe
    await stripe.paymentMethods.detach(paymentMethod.stripe_payment_method_id)

    // Delete from database
    const { error: deleteError } = await supabase
      .from('payment_methods')
      .delete()
      .eq('id', paymentMethodId)
      .eq('user_id', userId)

    if (deleteError) throw deleteError

    return NextResponse.json({
      success: true,
      message: 'Payment method removed successfully'
    })
  } catch (error) {
    console.error('Error removing payment method:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
