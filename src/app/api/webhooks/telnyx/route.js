//api/webhooks/telnyx/route.js

import { NextResponse } from 'next/server'
import telnyx from '@/lib/telnyx'
import { supabaseAdmin } from '@/lib/supabase-server'

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  
  if (digits.length === 10) {
    return `+1${digits}`
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    return phone
  }
  
  return `+1${digits}`
}

async function getOrCreateConversation(fromNumber, toNumber) {
  const normalizedFrom = normalizePhoneNumber(fromNumber)
  const normalizedTo = normalizePhoneNumber(toNumber)

  try {
    // Strict exact match on both contact number AND our business number
    // Never fall back to updating an existing conversation's from_number,
    // as that would move messages from one phone line's inbox to another.
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedFrom)
      .eq('from_number', normalizedTo)
      .single()

    if (!error && conversation) return conversation

    // No exact match — create a new conversation for this line+contact pair.
    // Upsert handles race conditions without overwriting existing records.
    const { data: newConversation, error: createError } = await supabaseAdmin
      .from('conversations')
      .upsert(
        { phone_number: normalizedFrom, from_number: normalizedTo, name: null },
        { onConflict: 'phone_number,from_number', ignoreDuplicates: false }
      )
      .select()
      .single()

    if (createError) throw createError
    return newConversation

  } catch (error) {
    console.error('Error in getOrCreateConversation:', error)
    throw error
  }
}

export async function POST(request) {
  try {
    const body = await request.text()
    console.log('Telnyx webhook received:', body)

    const signature = request.headers.get('telnyx-signature-ed25519')
    const timestamp = request.headers.get('telnyx-timestamp')

    // Verify webhook signature (optional in development)
    if (process.env.NODE_ENV === 'production') {
      if (!telnyx.verifyWebhookSignature(body, signature, timestamp)) {
        console.warn('Invalid webhook signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const event = telnyx.parseWebhookEvent(body)
    console.log('Parsed webhook event:', event.eventType, event.messageId)

    switch (event.eventType) {
      case 'message.received':
        await handleIncomingMessage(event)
        break

      case 'message.sent':
        await handleMessageSent(event)
        break

      case 'message.delivered':
        await handleMessageDelivered(event)
        break

      case 'message.delivery_failed':
      case 'message.failed':
        await handleMessageFailed(event)
        break

      case 'message.finalized':
        await handleMessageFinalized(event)
        break

      default:
        console.log(`Unhandled event type: ${event.eventType}`)
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error processing Telnyx webhook:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function handleIncomingMessage(event) {
  try {
    const { payload } = event
    const fromNumber = payload.from.phone_number
    const toNumber = payload.to[0].phone_number
    const messageBody = payload.text
    const telnyxMessageId = payload.id

    console.log(`Incoming message from ${fromNumber} to ${toNumber}`)

    // Get or create conversation
    const conversation = await getOrCreateConversation(fromNumber, toNumber)

    // Create message record
    const { data: messageRecord, error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        telnyx_message_id: telnyxMessageId,
        direction: 'inbound',
        from_number: normalizePhoneNumber(fromNumber),
        to_number: normalizePhoneNumber(toNumber),
        body: messageBody,
        status: 'received',
        delivery_details: JSON.stringify({
          received_at: event.occurredAt,
          webhook_id: event.messageId,
          media: payload.media || null
        })
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating inbound message:', error)
      return
    }

    // Update conversation timestamp
    await supabaseAdmin
      .from('conversations')
      .update({ 
        last_message_at: new Date().toISOString()
      })
      .eq('id', conversation.id)

    console.log('Inbound message saved successfully:', messageRecord.id)

  } catch (error) {
    console.error('Error handling incoming message:', error)
  }
}

async function handleMessageSent(event) {
  try {
    const { payload } = event
    const telnyxMessageId = payload.id

    await supabaseAdmin
      .from('messages')
      .update({
        status: 'sent',
        delivery_details: JSON.stringify({
          sent_at: event.occurredAt,
          webhook_id: event.messageId
        })
      })
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message sent status updated: ${telnyxMessageId}`)

  } catch (error) {
    console.error('Error handling message sent:', error)
  }
}

async function handleMessageDelivered(event) {
  try {
    const { payload } = event
    const telnyxMessageId = payload.id
    const deliveredAt = new Date(event.occurredAt).toISOString()

    await supabaseAdmin
      .from('messages')
      .update({
        status: 'delivered',
        delivered_at: deliveredAt,
        delivery_details: JSON.stringify({
          delivered_at: deliveredAt,
          webhook_id: event.messageId
        })
      })
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message delivered status updated: ${telnyxMessageId}`)

  } catch (error) {
    console.error('Error handling message delivered:', error)
  }
}

async function handleMessageFailed(event) {
  try {
    const { payload } = event
    const telnyxMessageId = payload.id

    await supabaseAdmin
      .from('messages')
      .update({
        status: 'failed',
        error_details: JSON.stringify({
          error_code: payload.error_code || 'unknown',
          error_message: payload.error_message || 'Delivery failed',
          failed_at: event.occurredAt,
          webhook_id: event.messageId
        })
      })
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message failed status updated: ${telnyxMessageId}`)

  } catch (error) {
    console.error('Error handling message failed:', error)
  }
}

async function handleMessageFinalized(event) {
  try {
    const { payload } = event
    const telnyxMessageId = payload.id

    const deliveryDetails = {
      finalized_at: event.occurredAt,
      final_status: payload.to[0]?.status || 'unknown',
      cost: payload.cost || null,
      webhook_id: event.messageId
    }

    await supabaseAdmin
      .from('messages')
      .update({
        delivery_details: JSON.stringify(deliveryDetails)
      })
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message finalized: ${telnyxMessageId}`)

  } catch (error) {
    console.error('Error handling message finalized:', error)
  }
}

export async function GET(request) {
  return NextResponse.json({ 
    status: 'webhook endpoint active',
    timestamp: new Date().toISOString(),
    url: request.url
  })
}