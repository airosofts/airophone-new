//api/webhooks/telnyx/route.js

import { NextResponse } from 'next/server'
import telnyx from '@/lib/telnyx'
import { supabaseAdmin } from '@/lib/supabase-server'
import { findMatchingScenario, executeScenario } from '@/lib/scenario-service'
import { containsStopKeyword, stopFollowups, updateFollowupState } from '@/lib/followup-service'
import { sendPushToWorkspace } from '@/lib/expo-push'
import { isInBusinessHours, nextBusinessTime } from '@/lib/scheduling'

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
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedFrom)
      .eq('from_number', normalizedTo)
      .maybeSingle()

    if (conversation) {
      // Backfill workspace_id if missing
      if (!conversation.workspace_id) {
        const workspaceId = await getWorkspaceIdForNumber(normalizedTo)
        if (workspaceId) {
          await supabaseAdmin
            .from('conversations')
            .update({ workspace_id: workspaceId })
            .eq('id', conversation.id)
          conversation.workspace_id = workspaceId
        }
      }
      return conversation
    }

    // Resolve workspace from the receiving phone number
    const workspaceId = await getWorkspaceIdForNumber(normalizedTo)

    // No exact match — create a new conversation for this line+contact pair.
    const { data: newConversation, error: createError } = await supabaseAdmin
      .from('conversations')
      .upsert(
        { phone_number: normalizedFrom, from_number: normalizedTo, name: null, workspace_id: workspaceId },
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

async function getWorkspaceIdForNumber(normalizedNumber) {
  try {
    const digits = normalizedNumber?.replace(/\D/g, '').slice(-10)
    if (!digits) return null
    const { data } = await supabaseAdmin
      .from('phone_numbers')
      .select('workspace_id')
      .like('phone_number', `%${digits}`)
      .limit(1)
      .maybeSingle()
    return data?.workspace_id || null
  } catch {
    return null
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

      case '10dlc.phone_number.update':
        await handlePhoneNumberUpdate(event)
        break

      case '10dlc.campaign.update':
      case '10dlc.brand.update':
        console.log(`[10dlc] ${event.eventType}:`, JSON.stringify(event.payload))
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

    // Idempotency check: Telnyx retries webhooks if our endpoint takes too long
    // (>15s) or returns a 5xx. Without this, we'd insert the same inbound twice
    // AND fire the AI scenario twice. The DB UNIQUE INDEX on telnyx_message_id
    // is the source of truth — the check below is a fast-path early exit so we
    // don't redundantly try to claim the conversation row first.
    if (telnyxMessageId) {
      const { data: existing } = await supabaseAdmin
        .from('messages')
        .select('id, conversation_id')
        .eq('telnyx_message_id', telnyxMessageId)
        .maybeSingle()
      if (existing) {
        console.log(`[webhook] Duplicate inbound (Telnyx retry) for ${telnyxMessageId} — skipping`)
        return
      }
    }

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
        // Normalize inbound MMS media so the chat bubble can render it.
        media_urls: Array.isArray(payload.media) && payload.media.length
          ? payload.media.map(m => ({ url: m.url, type: m.content_type || null })).filter(m => m.url)
          : null,
        delivery_details: JSON.stringify({
          received_at: event.occurredAt,
          webhook_id: event.messageId,
          media: payload.media || null
        })
      })
      .select()
      .single()

    if (error) {
      // Race condition fallback — if the UNIQUE index caught a parallel retry
      // between our SELECT above and this INSERT, the duplicate must be the
      // already-processed one. Bail silently.
      if (error.code === '23505') {
        console.log(`[webhook] Duplicate inbound caught by UNIQUE index for ${telnyxMessageId} — skipping`)
        return
      }
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

    // Mobile push — notify the workspace's devices of the new inbound message.
    if (conversation.workspace_id) {
      sendPushToWorkspace(conversation.workspace_id, {
        title: conversation.name || normalizePhoneNumber(fromNumber),
        body: messageBody || 'New message',
        data: { type: 'message', conversationId: conversation.id },
      })
    }

    // Two-way Monday sync: if this conversation originated from a Monday
    // automation, update the configured column on the source item (e.g.
    // status → Engaged, Last Contact → today). Best-effort; never throws.
    try {
      const { runWriteback } = await import('@/lib/monday-writeback')
      runWriteback(conversation.id, 'reply').catch(() => {})
    } catch { /* keep going — writeback is non-critical */ }

    // Deduct credit for received message
    try {
      const digits = normalizePhoneNumber(toNumber)?.replace(/\D/g, '').slice(-10)
      if (digits) {
        const { data: phoneRec } = await supabaseAdmin
          .from('phone_numbers')
          .select('workspace_id')
          .like('phone_number', `%${digits}`)
          .limit(1)
          .maybeSingle()

        if (phoneRec?.workspace_id) {
          const { data: ws } = await supabaseAdmin
            .from('workspaces')
            .select('created_by')
            .eq('id', phoneRec.workspace_id)
            .single()

          if (ws?.created_by) {
            const { getWorkspaceMessageRate } = await import('@/lib/pricing')
            const rate = await getWorkspaceMessageRate(phoneRec.workspace_id)
            const { data: result, error } = await supabaseAdmin.rpc('deduct_message_cost', {
              p_user_id: ws.created_by,
              p_workspace_id: phoneRec.workspace_id,
              p_message_count: 1,
              p_cost_per_message: rate,
              p_description: `Inbound SMS from ${normalizePhoneNumber(fromNumber)}`,
              p_campaign_id: null,
              p_message_id: messageRecord.id,
              p_recipient_phone: normalizePhoneNumber(fromNumber)
            })
            if (error) console.error('[webhook] Inbound deduction error:', error.message)
            else console.log(`[webhook] Inbound SMS deducted $${rate} — new balance: ${result?.new_balance}`)
          }
        }
      }
    } catch (deductErr) {
      console.error('[webhook] Inbound deduction failed (non-critical):', deductErr.message)
    }

    // Check for matching scenario
    const scenario = await findMatchingScenario(
      normalizePhoneNumber(toNumber),   // recipient (our number)
      normalizePhoneNumber(fromNumber)  // sender (their number)
    )

    if (scenario) {
      console.log(`Found matching scenario: ${scenario.name} (ID: ${scenario.id})`)

      // Per-LINE AI switch — if auto-reply is turned off for this number, a human
      // is handling the whole line; never auto-respond.
      const ourDigits = normalizePhoneNumber(toNumber)?.replace(/\D/g, '').slice(-10)
      if (ourDigits) {
        const { data: lineRow } = await supabaseAdmin
          .from('phone_numbers')
          .select('ai_enabled')
          .like('phone_number', `%${ourDigits}`)
          .limit(1)
          .maybeSingle()
        if (lineRow && lineRow.ai_enabled === false) {
          console.log(`AI disabled for line ${normalizePhoneNumber(toNumber)} - skipping AI response`)
          return
        }
      }

      // Skip if manual override is active
      if (conversation.manual_override) {
        console.log(`Manual override active for conversation ${conversation.id} - skipping AI response`)
        return
      }

      // Check for STOP keywords
      if (containsStopKeyword(messageBody, scenario.auto_stop_keywords)) {
        console.log('STOP keyword detected - stopping follow-ups')
        await stopFollowups(conversation.id, scenario.id)

        const confirmMessage = "You have been unsubscribed from automated messages. Reply START to opt back in."
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: normalizePhoneNumber(toNumber),
          to_number: normalizePhoneNumber(fromNumber),
          body: confirmMessage,
          status: 'queued'
        })
        try {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/sms/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: normalizePhoneNumber(fromNumber),
              from: normalizePhoneNumber(toNumber),
              message: confirmMessage
            })
          })
        } catch (sendError) {
          console.error('Error sending STOP confirmation:', sendError)
        }
        return
      }

      // Update follow-up state (customer sent a message)
      await updateFollowupState(conversation.id, scenario.id, 'customer')

      // AI reply hours (user preference). In 'business_hours' mode, a message
      // that arrives OUTSIDE business hours is not answered now — we DEFER the
      // reply to the next business-day opening (cron sweeps deferred_ai_replies)
      // so the lead still gets a reply, just at the right time. 'anytime' (default)
      // replies immediately. Either way, clear any stale deferred row when we do
      // reply in-hours so we never double-answer.
      if (scenario.ai_reply_mode === 'business_hours') {
        const { data: ws } = await supabaseAdmin
          .from('workspaces')
          .select('business_hours_start, business_hours_end, business_hours_tz, business_days')
          .eq('id', conversation.workspace_id)
          .maybeSingle()
        if (ws?.business_hours_start && ws?.business_hours_end && !isInBusinessHours(new Date(), ws)) {
          const runAt = nextBusinessTime(new Date(), ws)
          await supabaseAdmin.from('deferred_ai_replies').upsert({
            workspace_id: conversation.workspace_id,
            conversation_id: conversation.id,
            scenario_id: scenario.id,
            run_at: runAt.toISOString(),
          }, { onConflict: 'conversation_id' })
          console.log(`[telnyx] AI reply deferred to ${runAt.toISOString()} for conversation ${conversation.id} (business-hours mode)`)
          return
        }
      }
      // In-hours (or anytime mode): drop any pending deferred reply so it can't
      // fire a duplicate later.
      await supabaseAdmin.from('deferred_ai_replies').delete().eq('conversation_id', conversation.id)

      // Execute scenario inline. Previously this was fire-and-forget, but on
      // serverless platforms the function process can be killed right after the
      // HTTP response is returned — silently aborting the AI reply mid-flight.
      // Telnyx accepts webhooks that take up to 15s; AI generation is well under that.
      try {
        const result = await executeScenario(scenario, messageRecord, conversation)
        if (result.success) {
          console.log('Scenario executed successfully:', { scenarioId: scenario.id, replySent: !!result.reply })
        } else {
          console.error('Scenario execution failed:', { scenarioId: scenario.id, error: result.error })
        }
      } catch (err) {
        console.error('Scenario execution error:', { scenarioId: scenario.id, error: err.message })
      }
    } else {
      console.log('No matching scenario found for this message')
    }

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
        error_code: null,
        error_message: null,
        error_details: null,
        delivery_details: JSON.stringify({
          delivered_at: deliveredAt,
          webhook_id: event.messageId,
        }),
      })
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message delivered status updated: ${telnyxMessageId}`)

    // If this was a follow-up stage send, promote its 'sent' event to
    // 'delivered' so the Logs page / timeline reflect carrier confirmation.
    const { data: sentEv } = await supabaseAdmin
      .from('followup_events')
      .select('workspace_id, conversation_id, scenario_id, stage_number')
      .eq('type', 'sent')
      .filter('meta->>telnyx_message_id', 'eq', telnyxMessageId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (sentEv) {
      const { logFollowupEvent } = await import('@/lib/followup-service')
      await logFollowupEvent({
        workspaceId: sentEv.workspace_id,
        conversationId: sentEv.conversation_id,
        scenarioId: sentEv.scenario_id,
        stageNumber: sentEv.stage_number,
        type: 'delivered',
        occurredAt: deliveredAt,
      })
    }

  } catch (error) {
    console.error('Error handling message delivered:', error)
  }
}

// Carrier error info can appear in multiple places in a Telnyx webhook payload:
//   - payload.errors[0]            (top-level array; most reliable)
//   - payload.to[0].errors[0]      (per-recipient array; sometimes present)
//   - payload.to[0].error_code     (older legacy shape)
//   - payload.error_code           (very old legacy shape)
// We probe all of them so the carrier code (e.g. "30007") makes it into the DB.
function extractCarrierError(payload) {
  const topErr = payload?.errors?.[0]
  const toErr  = payload?.to?.[0]?.errors?.[0]
  const err = topErr || toErr || null
  const code = err?.code
    || payload?.to?.[0]?.error_code
    || payload?.error_code
    || null
  const message = err?.title
    || err?.detail
    || payload?.to?.[0]?.error_message
    || payload?.error_message
    || null
  return {
    code: code ? String(code) : null,
    message: message || null,
  }
}

async function handleMessageFailed(event) {
  try {
    const { payload } = event
    const telnyxMessageId = payload.id
    const { code, message } = extractCarrierError(payload)
    const errorCode = code || 'unknown'
    const errorMessage = message || 'Delivery failed'

    await supabaseAdmin
      .from('messages')
      .update({
        status: 'failed',
        error_code: errorCode,
        error_message: errorMessage,
        error_details: JSON.stringify({
          error_code: errorCode,
          error_message: errorMessage,
          failed_at: event.occurredAt,
          webhook_id: event.messageId,
        }),
      })
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message failed status updated: ${telnyxMessageId} (code ${errorCode})`)

  } catch (error) {
    console.error('Error handling message failed:', error)
  }
}

async function handleMessageFinalized(event) {
  try {
    const { payload } = event
    const telnyxMessageId = payload.id
    const finalStatus = payload.to[0]?.status || 'unknown'

    const deliveryDetails = {
      finalized_at: event.occurredAt,
      final_status: finalStatus,
      cost: payload.cost || null,
      webhook_id: event.messageId
    }

    // Defensive: if delivery_failed/failed webhook was missed, mark as failed here.
    // Telnyx's per-recipient terminal states are 'delivered', 'sending_failed',
    // 'delivery_failed', and 'delivery_unconfirmed'. Anything that's not 'delivered'
    // and not already 'failed' should be marked failed so the UI shows it.
    const update = { delivery_details: JSON.stringify(deliveryDetails) }
    if (finalStatus && finalStatus !== 'delivered') {
      const { data: current } = await supabaseAdmin
        .from('messages')
        .select('status, error_details')
        .eq('telnyx_message_id', telnyxMessageId)
        .single()

      if (current && current.status !== 'failed' && current.status !== 'received') {
        update.status = 'failed'
        if (!current.error_details) {
          // Prefer the real carrier code if Telnyx included one — falls back
          // to a friendly description tied to the final status.
          const carrier = extractCarrierError(payload)
          const code = carrier.code || 'finalized_' + finalStatus
          const message = carrier.message || (
              finalStatus === 'sending_failed'      ? 'Message rejected by network'
            : finalStatus === 'delivery_failed'     ? 'Could not be delivered'
            : finalStatus === 'delivery_unconfirmed' ? 'Delivery could not be confirmed'
            : `Final status: ${finalStatus}`)
          update.error_code = code
          update.error_message = message
          update.error_details = JSON.stringify({
            error_code: code,
            error_message: message,
            failed_at: event.occurredAt,
            webhook_id: event.messageId,
          })
        }
      }
    }

    await supabaseAdmin
      .from('messages')
      .update(update)
      .eq('telnyx_message_id', telnyxMessageId)

    console.log(`Message finalized: ${telnyxMessageId} (final: ${finalStatus})`)

  } catch (error) {
    console.error('Error handling message finalized:', error)
  }
}

async function handlePhoneNumberUpdate(event) {
  try {
    console.log('[10dlc.phone_number.update] payload:', JSON.stringify(event.payload))

    // Payload fields (from Telnyx docs): phoneNumber, assignmentStatus,
    // tmobileNumberMappingStatus, attNumberMappingStatus, nonTmobileNumberMappingStatus
    const phoneNumber = event.payload?.phoneNumber || event.payload?.phone_number
    if (!phoneNumber) {
      console.warn('[10dlc] phone_number.update missing phoneNumber:', event.payload)
      return
    }

    const normalized = normalizePhoneNumber(phoneNumber)

    // Map Telnyx assignmentStatus → our campaign_status
    const assignmentStatus = event.payload?.assignmentStatus
    let status = null
    if (assignmentStatus === 'ASSIGNED') status = 'approved'
    else if (assignmentStatus === 'FAILED') status = 'rejected'
    else if (assignmentStatus === 'PENDING_ASSIGNMENT') status = 'pending'
    else if (assignmentStatus === 'DELETED') status = null

    if (status !== null) {
      await supabaseAdmin
        .from('phone_numbers')
        .update({ campaign_status: status, updated_at: new Date().toISOString() })
        .eq('phone_number', normalized)
      console.log(`[10dlc] ${normalized} → campaign_status: ${status} (assignmentStatus: ${assignmentStatus})`)
    }
  } catch (error) {
    console.error('Error handling 10dlc.phone_number.update:', error)
  }
}

export async function GET(request) {
  return NextResponse.json({
    status: 'webhook endpoint active',
    timestamp: new Date().toISOString(),
    url: request.url
  })
}