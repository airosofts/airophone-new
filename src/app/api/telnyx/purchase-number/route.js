// API endpoint to purchase phone numbers from Telnyx
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const TELNYX_API_KEY = process.env.TELNYX_API_KEY

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export async function POST(request) {
  try {
    console.log('=== Phone Number Purchase Request ===')

    // Get user and workspace context
    const user = getUserFromRequest(request)
    if (!user || !user.userId) {
      return NextResponse.json(
        { error: 'Unauthorized - User not found' },
        { status: 401 }
      )
    }

    const workspace = getWorkspaceFromRequest(request)
    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Unauthorized - Workspace not found' },
        { status: 401 }
      )
    }

    const { phoneNumber, upfrontCost, monthlyCost, vat, totalCost } = await request.json()

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    console.log('Purchase request:', {
      phoneNumber,
      upfrontCost,
      monthlyCost,
      vat,
      totalCost,
      userId: user.userId,
      workspaceId: workspace.workspaceId
    })

    // Step 1: Check wallet balance
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('wallets')
      .select('id, balance')
      .eq('user_id', user.userId)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Wallet not found. Please create a wallet first.' },
        { status: 404 }
      )
    }

    // Use totalCost which includes setup fee + first month + VAT
    const purchasePrice = parseFloat(totalCost) || 2.30

    if (wallet.balance < purchasePrice) {
      return NextResponse.json(
        {
          error: 'Insufficient balance',
          required: purchasePrice,
          available: wallet.balance,
          shortfall: purchasePrice - wallet.balance
        },
        { status: 402 } // Payment Required
      )
    }

    // Step 2: Purchase number from Telnyx
    console.log('Purchasing from Telnyx:', phoneNumber)

    const telnyxResponse = await fetch('https://api.telnyx.com/v2/number_orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone_numbers: [
          {
            phone_number: phoneNumber
          }
        ],
        messaging_profile_id: workspace.messagingProfileId || undefined,
        billing_group_id: workspace.billingGroupId || undefined
      })
    })

    if (!telnyxResponse.ok) {
      const errorData = await telnyxResponse.json().catch(() => ({}))
      console.error('Telnyx purchase failed:', errorData)

      return NextResponse.json(
        {
          error: 'Failed to purchase number from Telnyx',
          details: errorData.errors || errorData.message || 'Unknown error'
        },
        { status: telnyxResponse.status }
      )
    }

    const telnyxData = await telnyxResponse.json()
    console.log('Telnyx purchase successful:', telnyxData.data)

    // Extract phone number ID from Telnyx response
    const phoneNumberId = telnyxData.data.phone_numbers?.[0]?.id ||
                          telnyxData.data.id ||
                          `telnyx_${Date.now()}`

    // Step 3: Use database RPC function to handle wallet deduction and records
    const { data: purchaseResult, error: purchaseError } = await supabaseAdmin
      .rpc('purchase_phone_number', {
        p_user_id: user.userId,
        p_phone_number_id: phoneNumberId,
        p_phone_number: phoneNumber,
        p_workspace_id: workspace.workspaceId,
        p_purchase_price: purchasePrice,
        p_monthly_price: parseFloat(monthlyCost) || 0.00,
        p_messaging_profile_id: workspace.messagingProfileId || null,
        p_billing_group_id: workspace.billingGroupId || null
      })

    if (purchaseError) {
      console.error('Database purchase error:', purchaseError)

      // Critical: Number purchased from Telnyx but DB failed
      // This should trigger an alert/notification for manual intervention
      console.error('CRITICAL: Phone number purchased from Telnyx but database update failed!')
      console.error('Phone Number:', phoneNumber)
      console.error('Telnyx Order ID:', telnyxData.data.id)

      return NextResponse.json(
        {
          error: 'Purchase failed',
          message: purchaseError.message || 'Database error occurred',
          telnyxOrderId: telnyxData.data.id,
          requiresManualReview: true
        },
        { status: 500 }
      )
    }

    // Step 4: Update messaging profile in Telnyx (if not set during order)
    if (workspace.messagingProfileId && phoneNumberId) {
      try {
        await fetch(`https://api.telnyx.com/v2/phone_numbers/${phoneNumberId}/messaging`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_profile_id: workspace.messagingProfileId
          })
        })
        console.log('Messaging profile updated')
      } catch (error) {
        console.warn('Failed to update messaging profile (non-critical):', error.message)
      }
    }

    // Step 5: Update billing group in Telnyx (if not set during order)
    if (workspace.billingGroupId && phoneNumberId) {
      try {
        await fetch(`https://api.telnyx.com/v2/phone_numbers/${phoneNumberId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            billing_group_id: workspace.billingGroupId
          })
        })
        console.log('Billing group updated')
      } catch (error) {
        console.warn('Failed to update billing group (non-critical):', error.message)
      }
    }

    console.log('=== Purchase Complete ===')
    console.log('Result:', purchaseResult)

    return NextResponse.json({
      success: true,
      message: 'Phone number purchased successfully',
      data: {
        phoneNumber,
        phoneNumberId,
        purchasePrice,
        monthlyPrice: parseFloat(monthlyCost) || 0.00,
        previousBalance: purchaseResult.previous_balance,
        newBalance: purchaseResult.new_balance,
        transactionId: purchaseResult.transaction_id,
        telnyxOrderId: telnyxData.data.id,
        workspaceId: workspace.workspaceId,
        messagingProfileId: workspace.messagingProfileId,
        billingGroupId: workspace.billingGroupId
      }
    })

  } catch (error) {
    console.error('=== Purchase Error ===')
    console.error('Error:', error)
    console.error('Stack:', error.stack)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message
      },
      { status: 500 }
    )
  }
}
