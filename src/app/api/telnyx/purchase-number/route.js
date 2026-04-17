// API endpoint to purchase phone numbers from Telnyx
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const TELNYX_10DLC_CAMPAIGN_ID = process.env.TELNYX_10DLC_CAMPAIGN_ID
const TELNYX_CALL_CONNECTION_ID = process.env.TELNYX_CALL_CONNECTION_ID

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

    // Step 1: Check subscription is active — block canceled/past_due accounts
    const { data: subCheck } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (subCheck && ['canceled', 'past_due'].includes(subCheck.status)) {
      return NextResponse.json(
        { error: 'Your subscription is no longer active. Please reactivate to purchase phone numbers.' },
        { status: 403 }
      )
    }

    // Trial accounts can only have 1 number — block additional purchases
    if (subCheck?.status === 'trialing') {
      const { data: existingForTrialCheck } = await supabaseAdmin
        .from('phone_numbers')
        .select('id')
        .eq('workspace_id', workspace.workspaceId)
        .limit(1)

      if (existingForTrialCheck && existingForTrialCheck.length > 0) {
        return NextResponse.json(
          { error: 'trial_restriction', message: 'Trial accounts are limited to 1 phone number. Activate your paid plan to add more.' },
          { status: 403 }
        )
      }
    }

    // Step 2: Check wallet
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('wallets')
      .select('id, balance, credits')
      .eq('user_id', user.userId)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Wallet not found. Please complete onboarding first.' },
        { status: 404 }
      )
    }

    const purchasePrice = parseFloat(totalCost) || 2.30

    // Check if workspace has an active subscription and no phone numbers yet
    // First number is included in every plan — skip balance check in that case
    const { data: existingNumbers } = await supabaseAdmin
      .from('phone_numbers')
      .select('id')
      .eq('workspace_id', workspace.workspaceId)
      .limit(1)

    const { data: activeSub } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('workspace_id', workspace.workspaceId)
      .in('status', ['active', 'trialing'])
      .limit(1)

    const isFirstNumber = !existingNumbers || existingNumbers.length === 0
    const hasSubscription = activeSub && activeSub.length > 0
    const skipBalanceCheck = isFirstNumber && hasSubscription

    if (!skipBalanceCheck && wallet.balance < purchasePrice) {
      return NextResponse.json(
        {
          error: 'Insufficient balance',
          required: purchasePrice,
          available: wallet.balance,
          shortfall: purchasePrice - wallet.balance
        },
        { status: 402 }
      )
    }

    // Step 3: Purchase number from Telnyx
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
    // First included number costs 0 to deduct from balance
    const effectivePurchasePrice = skipBalanceCheck ? 0 : purchasePrice
    const { data: purchaseResult, error: purchaseError } = await supabaseAdmin
      .rpc('purchase_phone_number', {
        p_user_id: user.userId,
        p_phone_number_id: phoneNumberId,
        p_phone_number: phoneNumber,
        p_workspace_id: workspace.workspaceId,
        p_purchase_price: effectivePurchasePrice,
        p_monthly_price: skipBalanceCheck ? 0 : (parseFloat(monthlyCost) || 0.00),
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

    // Step 4.5: Assign to workspace's SIP credential connection (enables WebRTC calling)
    // We must use the workspace-specific SIP connection — not the shared TELNYX_CALL_CONNECTION_ID —
    // so incoming calls are routed to the correct browser WebRTC client.
    try {
      // Look up (or auto-provision) the workspace SIP credential connection
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('telnyx_connection_id, name')
        .eq('id', workspace.workspaceId)
        .single()

      let sipConnectionId = ws?.telnyx_connection_id

      if (!sipConnectionId) {
        // Auto-provision now so the number is immediately ready for calls
        const provisionRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL}/api/workspace/sip-credentials`, {
          headers: {
            'x-user-id': user.userId,
            'x-workspace-id': workspace.workspaceId,
            'x-messaging-profile-id': workspace.messagingProfileId || '',
          }
        })
        const provisionData = await provisionRes.json()
        sipConnectionId = provisionData.connectionId
      }

      if (sipConnectionId && phoneNumberId) {
        const telnyxId = telnyxData.data.phone_numbers?.[0]?.id || phoneNumberId
        await fetch(`https://api.telnyx.com/v2/phone_numbers/${telnyxId}/voice`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_id: sipConnectionId }),
        })
        console.log('Voice assigned to workspace SIP connection:', sipConnectionId)
      }
    } catch (error) {
      console.warn('Failed to assign SIP connection (non-critical):', error.message)
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

    // Step 5.5: Configure messaging profile webhook URL so inbound SMS is delivered (non-blocking)
    try {
      const appUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL
      const profileId = workspace.messagingProfileId || process.env.TELNYX_PROFILE_ID
      if (appUrl && profileId) {
        await fetch(`https://api.telnyx.com/v2/messaging_profiles/${profileId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhook_url: `${appUrl}/api/webhooks/telnyx`, webhook_api_version: '2' })
        })
        console.log('Messaging profile webhook URL configured')
      }
    } catch (error) {
      console.warn('Failed to set messaging profile webhook URL (non-critical):', error.message)
    }

    // Step 6: Assign number to 10DLC campaign (non-blocking — US numbers only)
    if (TELNYX_10DLC_CAMPAIGN_ID && phoneNumber.startsWith('+1')) {
      try {
        const campaignRes = await fetch('https://api.telnyx.com/v2/10dlc/phone_number_campaigns', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phoneNumber: phoneNumber,
            campaignId: TELNYX_10DLC_CAMPAIGN_ID,
          }),
        })
        if (campaignRes.ok) {
          console.log('10DLC campaign assigned:', phoneNumber)
          // Mark as pending — webhook will update to approved/rejected
          await supabaseAdmin.from('phone_numbers')
            .update({ campaign_status: 'pending', updated_at: new Date().toISOString() })
            .eq('phone_number', phoneNumber)
            .eq('workspace_id', workspace.workspaceId)
        } else {
          const err = await campaignRes.json().catch(() => ({}))
          console.warn('10DLC assignment failed (non-critical):', err)
        }
      } catch (error) {
        console.warn('10DLC assignment error (non-critical):', error.message)
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
        purchasePrice: effectivePurchasePrice,
        monthlyPrice: skipBalanceCheck ? 0 : (parseFloat(monthlyCost) || 0.00),
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
