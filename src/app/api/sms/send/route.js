import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import telnyx from '@/lib/telnyx'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { getWorkspaceMessageRate } from '@/lib/pricing'

async function resolveWalletOwnerId(userId, workspaceId) {
  // If workspaceId provided, look up workspace owner
  if (workspaceId) {
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('created_by')
      .eq('id', workspaceId)
      .single()
    if (workspace?.created_by) return workspace.created_by
  }
  // Fall back to self
  return userId
}

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

    // Use workspace owner's wallet for shared credits
    const walletOwnerId = await resolveWalletOwnerId(user.userId, workspace.workspaceId)

    // Check credits — try by user_id first, fall back to workspace_id for older accounts
    let canAfford = false
    let currentCredits = 0

    const { data: walletDirect } = await supabaseAdmin
      .from('wallets')
      .select('id, credits')
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (walletDirect) {
      currentCredits = parseFloat(walletDirect.credits) || 0
      canAfford = currentCredits >= messageRate
    } else {
      // Fallback: RPC lookup by user_id
      const { data: affordCheck } = await supabaseAdmin.rpc(
        'can_afford_message_cost_v2',
        { p_user_id: walletOwnerId, p_message_count: 1, p_cost_per_message: messageRate }
      )
      canAfford = affordCheck?.can_afford ?? false
      currentCredits = affordCheck?.current_balance ?? 0
    }

    if (!canAfford) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          message: `Insufficient credits. Current: ${Math.floor(currentCredits)}, required: ${Math.ceil(messageRate)}. Please top up your wallet.`,
          details: { currentBalance: currentCredits, requiredAmount: messageRate }
        },
        { status: 402 }
      )
    }

    // Resolve messaging profile for the from number
    // Priority: number's own profile (from phone_numbers table) → workspace profile → global env
    const { data: wsData } = await supabaseAdmin
      .from('workspaces')
      .select('messaging_profile_id')
      .eq('id', workspace.workspaceId)
      .single()

    const workspaceProfileId = wsData?.messaging_profile_id || process.env.TELNYX_PROFILE_ID

    // Look up the actual profile assigned to this specific number
    const { data: numberRow } = await supabaseAdmin
      .from('phone_numbers')
      .select('id, messaging_profile_id')
      .eq('phone_number', normalizePhoneNumber(from))
      .eq('workspace_id', workspace.workspaceId)
      .single()

    let messagingProfileId = numberRow?.messaging_profile_id || workspaceProfileId

    // If number has no profile assigned, assign the workspace profile now and save it
    if (!numberRow?.messaging_profile_id && messagingProfileId && numberRow?.id) {
      try {
        const assignRes = await fetch(`https://api.telnyx.com/v2/phone_numbers/${numberRow.id}/messaging`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
        })
        if (assignRes.ok) {
          await supabaseAdmin.from('phone_numbers')
            .update({ messaging_profile_id: messagingProfileId, updated_at: new Date().toISOString() })
            .eq('id', numberRow.id)
          console.log(`[sms/send] Assigned missing profile ${messagingProfileId} to ${from}`)
        }
      } catch (e) {
        console.warn('[sms/send] Failed to auto-assign profile (non-fatal):', e.message)
      }
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

    // Send SMS via Telnyx — no messaging_profile_id in payload; Telnyx resolves it from the from number
    const result = await telnyx.sendMessage(normalizedFrom, normalizedTo, message)

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

    // Deduct credits directly by workspace_id — reliable for all account ages
    if (walletDirect) {
      const newCredits = Math.max(0, currentCredits - messageRate)
      await supabaseAdmin
        .from('wallets')
        .update({ credits: newCredits, updated_at: new Date().toISOString() })
        .eq('id', walletDirect.id)
    } else {
      // Fallback: RPC deduction by user_id
      const { data: deductionResult, error: deductionError } = await supabaseAdmin.rpc(
        'deduct_message_cost',
        {
          p_user_id: walletOwnerId,
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
      }
    }

    // Log successful message transaction for tracking
    await supabaseAdmin
      .from('message_transactions')
      .insert({
        workspace_id: workspace.workspaceId,
        user_id: walletOwnerId,
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