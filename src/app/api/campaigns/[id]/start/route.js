//app/api/campaigns/[id]/start/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { getWorkspaceMessageRate, calculateMessageCost } from '@/lib/pricing'

export async function POST(request, { params }) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { id: campaignId } = await params

    // Get campaign details (workspace-filtered)
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    if (campaign.status !== 'draft') {
      return NextResponse.json(
        { error: 'Campaign is not in draft status' },
        { status: 400 }
      )
    }

    // Block trial accounts from sending campaigns
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (sub?.status === 'trialing') {
      return NextResponse.json(
        {
          error: 'trial_restriction',
          message: 'Campaign sending requires an active paid subscription. End your trial to start sending now.',
        },
        { status: 402 }
      )
    }

    // Get contacts from selected lists (workspace-filtered)
    const { data: rawContacts, error: contactsError } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .in('contact_list_id', campaign.contact_list_ids)

    if (contactsError) {
      console.error('Error fetching contacts:', contactsError)
      return NextResponse.json(
        { error: 'Failed to fetch contacts' },
        { status: 500 }
      )
    }

    // Dedupe by normalized phone number — same contact may appear in multiple selected lists
    const seenPhones = new Set()
    const contacts = []
    for (const c of (rawContacts || [])) {
      const normalized = normalizePhoneNumber(c.phone_number)
      if (!normalized || seenPhones.has(normalized)) continue
      seenPhones.add(normalized)
      contacts.push(c)
    }

    // Get current message rate for this workspace based on tiered pricing
    const messageCount = contacts.length
    const messageRate = await getWorkspaceMessageRate(workspace.workspaceId)

    // Check if user can afford the message costs (actual wallet balance)
    const { data: affordCheck, error: affordError } = await supabaseAdmin.rpc(
      'can_afford_message_cost_v2',
      {
        p_user_id: user.userId,
        p_message_count: messageCount,
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
          message: `Insufficient credits. Current credits: ${Math.floor(affordCheck?.current_balance || 0)}, Required: ${Math.floor(affordCheck?.required_amount || 0)} credits for ${messageCount} messages. Please top up your wallet to continue.`,
          details: {
            currentBalance: affordCheck?.current_balance || 0,
            requiredAmount: affordCheck?.required_amount || 0,
            shortage: affordCheck?.shortage || 0,
            messageCount
          }
        },
        { status: 402 }
      )
    }

    // Atomically claim the campaign — only proceed if it's still in draft.
    // This prevents a double-click / concurrent request from spawning two senders.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()

    if (claimError) {
      console.error('Error claiming campaign:', claimError)
      return NextResponse.json({ error: 'Failed to start campaign' }, { status: 500 })
    }

    if (!claimed) {
      // Another request already moved it out of draft — abort silently
      return NextResponse.json(
        { error: 'Campaign is already running or has finished' },
        { status: 409 }
      )
    }

    // Start sending messages in background
    processCampaignMessages(campaign, contacts, user.userId, workspace.workspaceId, messageRate)

    return NextResponse.json({
      success: true,
      message: 'Campaign started successfully',
      estimatedCost: (messageCount * messageRate).toFixed(2),
      messageRate: messageRate
    })

  } catch (error) {
    console.error('Error starting campaign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function processCampaignMessages(campaign, contacts, userId, workspaceId, messageRate) {
  let sentCount = 0
  let failedCount = 0

  for (const contact of contacts) {
    try {
      // Normalize phone numbers
      const normalizedContactNumber = normalizePhoneNumber(contact.phone_number)
      const normalizedSenderNumber = normalizePhoneNumber(campaign.sender_number)

      // Replace tags in message template
      let personalizedMessage = campaign.message_template
      personalizedMessage = personalizedMessage.replace(/{first_name}/g, contact.first_name || '')
      personalizedMessage = personalizedMessage.replace(/{last_name}/g, contact.last_name || '')
      personalizedMessage = personalizedMessage.replace(/{business_name}/g, contact.business_name || '')
      personalizedMessage = personalizedMessage.replace(/{phone}/g, contact.phone_number || '')
      personalizedMessage = personalizedMessage.replace(/{email}/g, contact.email || '')
      personalizedMessage = personalizedMessage.replace(/{city}/g, contact.city || '')
      personalizedMessage = personalizedMessage.replace(/{state}/g, contact.state || '')
      personalizedMessage = personalizedMessage.replace(/{country}/g, contact.country || '')

      // Get or create conversation — must match BOTH phone_number and from_number
      // so messages always appear under the correct sending line in the inbox.
      let conversation = null

      const { data: existingConversation } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('phone_number', normalizedContactNumber)
        .eq('from_number', normalizedSenderNumber)
        .maybeSingle()

      if (existingConversation) {
        // Backfill workspace_id if missing (old conversations created before this field was set)
        if (!existingConversation.workspace_id) {
          await supabaseAdmin
            .from('conversations')
            .update({ workspace_id: workspaceId })
            .eq('id', existingConversation.id)
          existingConversation.workspace_id = workspaceId
        }
        conversation = existingConversation
      } else {
        const { data: newConversation, error: conversationError } = await supabaseAdmin
          .from('conversations')
          .insert({
            phone_number: normalizedContactNumber,
            name: contact.business_name || null,
            from_number: normalizedSenderNumber,
            workspace_id: workspaceId,
            created_by: userId
          })
          .select()
          .single()

        // Race condition: another campaign message beat us to it
        if (conversationError && conversationError.code === '23505') {
          const { data: fallbackConversation } = await supabaseAdmin
            .from('conversations')
            .select('*')
            .eq('phone_number', normalizedContactNumber)
            .eq('from_number', normalizedSenderNumber)
            .single()

          conversation = fallbackConversation
        } else if (conversationError) {
          console.error('Error creating conversation:', conversationError)
          throw conversationError
        } else {
          conversation = newConversation
        }
      }

      // Send message via Telnyx
      const result = await telnyx.sendMessage(
        normalizedSenderNumber,
        normalizedContactNumber,
        personalizedMessage
      )

      if (result.success) {
        // Create message record
        const { data: messageRecord } = await supabaseAdmin
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            telnyx_message_id: result.messageId,
            direction: 'outbound',
            from_number: normalizedSenderNumber,
            to_number: normalizedContactNumber,
            body: personalizedMessage,
            status: 'sending',
            sent_by: userId
          })
          .select()
          .single()

        // Deduct message cost from wallet immediately
        const { data: deductionResult, error: deductionError } = await supabaseAdmin.rpc(
          'deduct_message_cost',
          {
            p_user_id: userId,
            p_workspace_id: workspaceId,
            p_message_count: 1,
            p_cost_per_message: messageRate,
            p_description: `Campaign: ${campaign.name || campaign.id} - SMS to ${normalizedContactNumber}`,
            p_campaign_id: campaign.id,
            p_message_id: messageRecord?.id,
            p_recipient_phone: normalizedContactNumber
          }
        )

        if (deductionError || !deductionResult?.success) {
          // Message is already sent — log the billing issue but do NOT throw.
          // Throwing here causes the catch block to mark the message as "failed"
          // even though Telnyx accepted and delivered it.
          console.warn('[campaign] Wallet deduction issue (non-fatal — message was sent):', deductionError?.message || deductionResult?.message)
        }

        // Update conversation timestamp - IMPORTANT for inbox ordering
        await supabaseAdmin
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString()
          })
          .eq('id', conversation.id)

        // Create campaign message tracking
        await supabaseAdmin
          .from('campaign_messages')
          .insert({
            campaign_id: campaign.id,
            contact_id: contact.id,
            status: 'sent',
            sent_at: new Date().toISOString()
          })

        // Log message transaction for tracking (using tiered pricing rate)
        await supabaseAdmin
          .from('message_transactions')
          .insert({
            workspace_id: workspaceId,
            user_id: userId,
            campaign_id: campaign.id,
            message_id: messageRecord?.id,
            recipient_phone: normalizedContactNumber,
            cost_per_message: messageRate,
            total_cost: messageRate,
            message_type: 'sms',
            status: 'sent'
          })

        sentCount++
      } else {
        // Create failed campaign message tracking
        await supabaseAdmin
          .from('campaign_messages')
          .insert({
            campaign_id: campaign.id,
            contact_id: contact.id,
            status: 'failed',
            error_message: result.error
          })

        // Don't charge for failed messages
        // Just log the failure in campaign_messages table
        console.log(`Message failed to ${normalizedContactNumber}: ${result.error}`)

        failedCount++
      }

      // Update campaign progress
      await supabaseAdmin
        .from('campaigns')
        .update({
          sent_count: sentCount,
          failed_count: failedCount
        })
        .eq('id', campaign.id)

      // Delay between messages
      if (campaign.delay_between_messages > 0) {
        await new Promise(resolve => setTimeout(resolve, campaign.delay_between_messages))
      }

    } catch (error) {
      console.error(`Error sending message to ${contact.phone_number}:`, error)

      // Create failed campaign message tracking
      await supabaseAdmin
        .from('campaign_messages')
        .insert({
          campaign_id: campaign.id,
          contact_id: contact.id,
          status: 'failed',
          error_message: error.message
        })

      // Don't charge for failed messages
      failedCount++
    }
  }

  // Mark campaign as completed
  await supabaseAdmin
    .from('campaigns')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount
    })
    .eq('id', campaign.id)
}