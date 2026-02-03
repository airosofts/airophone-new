import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  
  // Handle US numbers
  if (digits.length === 10) {
    return `+1${digits}`
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    return phone
  }
  
  return `+1${digits}` // Default to US
}

export async function POST(request, { params }) {
  try {
    const campaignId = params.id

    // Get campaign details
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
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

    // Get contacts from selected lists
    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .in('contact_list_id', campaign.contact_list_ids)

    if (contactsError) {
      console.error('Error fetching contacts:', contactsError)
      return NextResponse.json(
        { error: 'Failed to fetch contacts' },
        { status: 500 }
      )
    }

    // Normalize sender number
    const normalizedSenderNumber = normalizePhoneNumber(campaign.sender_number)

    // Update campaign status
    await supabaseAdmin
      .from('campaigns')
      .update({
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', campaignId)

    // Start sending messages in background
    processCampaignMessages(campaign, contacts, normalizedSenderNumber)

    return NextResponse.json({
      success: true,
      message: 'Campaign started successfully'
    })

  } catch (error) {
    console.error('Error starting campaign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function processCampaignMessages(campaign, contacts, normalizedSenderNumber, userId) {
  let sentCount = 0
  let failedCount = 0

  for (const contact of contacts) {
    try {
      // Normalize contact phone number
      const normalizedContactNumber = normalizePhoneNumber(contact.phone_number)

      // Replace tags in message template
      let personalizedMessage = campaign.message_template
      personalizedMessage = personalizedMessage.replace(/{name}/g, contact.name || '')
      personalizedMessage = personalizedMessage.replace(/{email}/g, contact.email || '')
      personalizedMessage = personalizedMessage.replace(/{city}/g, contact.city || '')
      personalizedMessage = personalizedMessage.replace(/{state}/g, contact.state || '')
      personalizedMessage = personalizedMessage.replace(/{country}/g, contact.country || '')

      // First try to find existing conversation
      let { data: existingConversation } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('phone_number', normalizedContactNumber)
        .eq('from_number', normalizedSenderNumber)
        .single()

      let conversation = existingConversation

      // Create new conversation if none exists
      if (!conversation) {
        const { data: newConversation, error: conversationError } = await supabaseAdmin
          .from('conversations')
          .insert({
            phone_number: normalizedContactNumber,
            name: contact.name,
            from_number: normalizedSenderNumber,
            created_by: userId
          })
          .select()
          .single()

        if (conversationError) {
          console.error('Error creating conversation:', conversationError)
          throw conversationError
        }

        conversation = newConversation
      }

      // Send message via Telnyx
      const result = await telnyx.sendMessage(
        normalizedSenderNumber,
        normalizedContactNumber,
        personalizedMessage
      )

      if (result.success) {
        // Create message record
        const { data: messageRecord, error: messageError } = await supabaseAdmin
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

        if (messageError) {
          console.error('Error creating message record:', messageError)
        }

        // Update conversation timestamp
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
            message_id: messageRecord?.id,
            status: 'sent',
            sent_at: new Date().toISOString()
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