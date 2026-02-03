import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import telnyx from '@/lib/telnyx'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { getWorkspaceMessageRate } from '@/lib/pricing'

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { from, to, message, conversationId } = body

    // Validate required fields
    if (!from || !to || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: from, to, message' },
        { status: 400 }
      )
    }

    // Get current message rate for this workspace based on tiered pricing
    const messageRate = await getWorkspaceMessageRate(workspace.workspaceId)

    // Check if user can afford the message cost (actual wallet balance)
    const { data: affordCheck, error: affordError } = await supabaseAdmin.rpc(
      'can_afford_message_cost_v2',
      {
        p_user_id: user.userId,
        p_message_count: 1,
        p_cost_per_message: messageRate
      }
    )

    if (affordError) {
      console.error('Error checking wallet balance:', affordError)
      return NextResponse.json(
        { error: 'Failed to verify balance' },
        { status: 500 }
      )
    }

    if (!affordCheck?.can_afford) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          message: `Insufficient credits. Current credits: ${Math.floor(affordCheck?.current_balance || 0)}, Required: ${Math.floor(affordCheck?.required_amount || 1)} credit. Please top up your wallet to continue.`,
          details: {
            currentBalance: affordCheck?.current_balance || 0,
            requiredAmount: affordCheck?.required_amount || 1,
            shortage: affordCheck?.shortage || 0
          }
        },
        { status: 402 }
      )
    }

    // Normalize phone numbers
    const normalizedFrom = normalizePhoneNumber(from)
    const normalizedTo = normalizePhoneNumber(to)

    // Get or create conversation
    let conversation
    try {
      if (conversationId) {
        // Use provided conversation ID
        const { data, error } = await supabaseAdmin
          .from('conversations')
          .select('*')
          .eq('id', conversationId)
          .single()

        if (error) {
          console.error('Conversation not found, creating new one')
          conversation = await getOrCreateConversation(normalizedTo, normalizedFrom)
        } else {
          conversation = data
        }
      } else {
        // Create or find conversation
        conversation = await getOrCreateConversation(normalizedTo, normalizedFrom)
      }
    } catch (convError) {
      console.error('Error handling conversation:', convError)
      return NextResponse.json(
        { error: 'Failed to create or find conversation' },
        { status: 500 }
      )
    }

    // Send SMS via Telnyx
    const result = await telnyx.sendMessage(normalizedFrom, normalizedTo, message, {
      webhook_url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/telnyx`,
      use_profile_webhooks: false
    })

    if (!result.success) {
      // Create failed message record
      const { data: failedMessage } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          telnyx_message_id: null,
          direction: 'outbound',
          from_number: normalizedFrom,
          to_number: normalizedTo,
          body: message,
          status: 'failed',
          error_details: JSON.stringify(result.error)
        })
        .select()
        .single()

      // Don't charge for failed messages - no wallet deduction
      console.error('Message failed to send:', result.error)

      return NextResponse.json(
        {
          error: 'Failed to send message',
          details: result.error,
          message: failedMessage,
          conversation: conversation
        },
        { status: 500 }
      )
    }

    // Create successful message record
    const { data: messageRecord, error: messageError } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        telnyx_message_id: result.messageId,
        direction: 'outbound',
        from_number: normalizedFrom,
        to_number: normalizedTo,
        body: message,
        status: 'sent'
      })
      .select()
      .single()

    if (messageError) {
      console.error('Error creating message record:', messageError)
      return NextResponse.json(
        { error: 'Message sent but failed to record in database' },
        { status: 500 }
      )
    }

    // Deduct message cost from wallet immediately
    const { data: deductionResult, error: deductionError } = await supabaseAdmin.rpc(
      'deduct_message_cost',
      {
        p_user_id: user.userId,
        p_workspace_id: workspace.workspaceId,
        p_message_count: 1,
        p_cost_per_message: messageRate,
        p_description: `SMS to ${normalizedTo}`,
        p_campaign_id: null,
        p_message_id: messageRecord?.id,
        p_recipient_phone: normalizedTo
      }
    )

    if (deductionError || !deductionResult?.success) {
      console.error('Error deducting from wallet:', deductionError || deductionResult)
      // Message was sent but wallet deduction failed - log this issue
      // You may want to handle this differently based on your business logic
    }

    // Log successful message transaction for tracking
    await supabaseAdmin
      .from('message_transactions')
      .insert({
        workspace_id: workspace.workspaceId,
        user_id: user.userId,
        campaign_id: null,
        message_id: messageRecord?.id,
        recipient_phone: normalizedTo,
        cost_per_message: messageRate,
        total_cost: messageRate,
        message_type: 'sms',
        status: 'sent'
      })

    // Update conversation timestamp
    await supabaseAdmin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString()
      })
      .eq('id', conversation.id)

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      message: messageRecord,
      conversation: conversation
    })

  } catch (error) {
    console.error('Error in SMS send API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// Helper function to get or create conversation
async function getOrCreateConversation(toNumber, fromNumber) {
  // Look for existing conversation with this phone number and from_number
  let { data: conversation, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('phone_number', toNumber)
    .eq('from_number', fromNumber)
    .single()

  // If no exact match, try to find conversation with just phone number
  if (error && error.code === 'PGRST116') {
    let { data: existingConversation } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('phone_number', toNumber)
      .single()

    // If conversation exists but from_number is different, update it
    if (existingConversation) {
      const { data: updatedConversation, error: updateError } = await supabaseAdmin
        .from('conversations')
        .update({
          from_number: fromNumber
        })
        .eq('id', existingConversation.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating conversation:', updateError)
      }

      conversation = updatedConversation || existingConversation
    } else {
      // Create new conversation if doesn't exist
      const { data: newConversation, error: createError } = await supabaseAdmin
        .from('conversations')
        .insert({
          phone_number: toNumber,
          from_number: fromNumber,
          name: null
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating conversation:', createError)
        throw createError
      }

      conversation = newConversation
    }
  } else if (error) {
    console.error('Error finding conversation:', error)
    throw error
  }

  return conversation
}