// src/app/api/webhooks/telnyx/call/route.js
// Sole authority for call records — creates, updates, and links to conversations
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { CALL_CREDITS_PER_MINUTE } from '@/lib/pricing'
import webpush from 'web-push'

// Send Web Push to all subscriptions for a workspace (non-blocking)
async function sendCallPush(workspaceId, fromNumber) {
  console.log('[call-push] sendCallPush called — workspace:', workspaceId, 'from:', fromNumber, 'vapid set:', !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[call-push] VAPID keys not set — skipping push')
    return
  }
  if (!workspaceId) return

  // setVapidDetails must be called at runtime (not module level) so env vars are available
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@airophone.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  try {
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('workspace_id', workspaceId)

    if (!subs?.length) return

    const payload = JSON.stringify({
      title: '📞 Incoming Call',
      body: `Call from ${fromNumber || 'Unknown'} — tap to answer`,
      from: fromNumber,
      callId: null,  // browser already has the call object via WebRTC SDK
      workspaceId,
      tag: 'incoming-call'
    })

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async (err) => {
          // 410 = subscription expired/revoked — clean it up
          if (err.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
            console.log('[call-push] Removed expired subscription:', sub.endpoint.slice(-20))
          } else {
            console.warn('[call-push] Push failed:', err.statusCode, err.message)
          }
        })
      )
    )
    console.log(`[call-push] Sent ${results.length} push(es) for workspace:`, workspaceId)
  } catch (err) {
    console.warn('[call-push] Error sending push:', err.message)
  }
}

function mapDirection(d) {
  if (d === 'incoming') return 'inbound'
  if (d === 'outgoing') return 'outbound'
  return d
}

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+1${digits}`
}

export async function POST(request) {
  try {
    const body = await request.text()
    const event = JSON.parse(body)
    const eventType = event?.data?.event_type
    const payload = event?.data?.payload
    const callId = payload?.call_control_id

    console.log('[call-webhook]', eventType, callId?.slice(0, 20), payload?.from, '->', payload?.to)

    const supabase = createSupabaseServerClient()

    switch (eventType) {
      case 'call.initiated':
        await handleCallInitiated(supabase, payload)
        break
      case 'call.answered':
        await supabase.from('calls')
          .update({ status: 'answered', answered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('telnyx_call_id', callId)
        console.log('[call-webhook] Marked answered:', callId?.slice(0, 20))
        break
      case 'call.hangup':
        await handleCallHangup(supabase, payload)
        break
      case 'call.recording.saved':
        await supabase.from('calls')
          .update({ recording_url: payload.recording_urls?.mp3 || payload.recording_urls?.wav, has_recording: true, updated_at: new Date().toISOString() })
          .eq('telnyx_call_id', callId)
        break
    }
  } catch (err) {
    console.error('[call-webhook] ERROR:', err.message)
  }

  return NextResponse.json({ success: true })
}

async function findOrCreateConversation(supabase, contactNumber, ourNumber, workspaceId) {
  const normalizedContact = normalizePhoneNumber(contactNumber)
  const normalizedOur = normalizePhoneNumber(ourNumber)
  if (!normalizedContact || !normalizedOur) return null

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('phone_number', normalizedContact)
    .eq('from_number', normalizedOur)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      phone_number: normalizedContact,
      from_number: normalizedOur,
      workspace_id: workspaceId,
      status: 'open',
      last_message_at: new Date().toISOString()
    })
    .select('id')
    .single()

  if (error) {
    const { data: retry } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', normalizedContact)
      .eq('from_number', normalizedOur)
      .maybeSingle()
    return retry?.id || null
  }

  return created?.id || null
}

async function handleCallInitiated(supabase, payload) {
  const callControlId = payload.call_control_id
  const toNumber = payload.to
  const fromNumber = payload.from
  const dbDirection = mapDirection(payload.direction)

  // Dedup by exact telnyx_call_id
  const { data: existing } = await supabase
    .from('calls')
    .select('id')
    .eq('telnyx_call_id', callControlId)
    .maybeSingle()

  if (existing) return

  const isIncoming = payload.direction === 'incoming'
  const ourNumber = isIncoming ? toNumber : fromNumber
  const contactNumber = isIncoming ? fromNumber : toNumber
  const digits = ourNumber?.replace(/\D/g, '').slice(-10)

  let workspaceId = null
  let forwardedTo = null
  let conversationId = null

  if (digits) {
    const { data: phoneRec } = await supabase
      .from('phone_numbers')
      .select('workspace_id, id, phone_number')
      .like('phone_number', `%${digits}`)
      .limit(1)
      .maybeSingle()

    if (phoneRec) {
      workspaceId = phoneRec.workspace_id

      if (isIncoming) {
        const { data: fwdRule } = await supabase
          .from('call_forwarding_rules')
          .select('forward_to, id')
          .eq('phone_number_id', phoneRec.id)
          .eq('is_active', true)
          .maybeSingle()

        if (fwdRule) forwardedTo = fwdRule.forward_to
      }

      conversationId = await findOrCreateConversation(supabase, contactNumber, ourNumber, workspaceId)
    }
  }

  const { error } = await supabase.from('calls').insert({
    telnyx_call_id: callControlId,
    from_number: fromNumber,
    to_number: toNumber,
    direction: dbDirection,
    status: forwardedTo ? 'forwarded' : 'ringing',
    forwarded_to: forwardedTo,
    workspace_id: workspaceId,
    conversation_id: conversationId,
    created_at: new Date().toISOString()
  })

  if (error && error.code !== '23505') {
    console.error('[call-webhook] Insert error:', error.message)
  } else {
    console.log('[call-webhook] Created call record:', callControlId?.slice(0, 20), 'conv:', conversationId?.slice(0, 8))
    // Fire Web Push to all subscriptions for this workspace so background tabs get notified
    if (isIncoming && workspaceId) {
      sendCallPush(workspaceId, fromNumber)  // non-blocking, intentionally no await
    }
  }
}

async function handleCallHangup(supabase, payload) {
  const endTime = new Date().toISOString()
  const hangupCause = payload.hangup_cause || 'normal_clearing'
  const callControlId = payload.call_control_id

  const { data: call } = await supabase
    .from('calls')
    .update({ ended_at: endTime, hangup_cause: hangupCause, updated_at: endTime })
    .eq('telnyx_call_id', callControlId)
    .select('id, status, answered_at, forwarded_to, created_at')
    .maybeSingle()

  if (!call) {
    console.log('[call-webhook] Hangup: no matching record for', callControlId?.slice(0, 20))
    return
  }

  // Determine final status
  let finalStatus = 'completed'
  if (call.forwarded_to) {
    finalStatus = 'forwarded'
  } else if (!call.answered_at) {
    finalStatus = 'missed'
  }

  const updates = { status: finalStatus }

  // Calculate duration from answered_at to now
  if (call.answered_at) {
    updates.duration_seconds = Math.floor((new Date(endTime) - new Date(call.answered_at)) / 1000)
  }

  await supabase.from('calls').update(updates).eq('id', call.id)
  console.log('[call-webhook] Hangup:', callControlId?.slice(0, 20), 'status:', finalStatus, 'duration:', updates.duration_seconds || 0)

  // Deduct credits for completed calls (only if answered and has duration)
  if (finalStatus === 'completed' && updates.duration_seconds > 0) {
    await deductCallCredits(call.id, updates.duration_seconds, payload)
  }
}

async function deductCallCredits(callId, durationSeconds, payload) {
  try {
    // Calculate credits: duration_seconds / 60 * CALL_CREDITS_PER_MINUTE
    // e.g. 30s = 0.5 credits, 90s = 1.5 credits
    const creditsToDeduct = (durationSeconds / 60) * CALL_CREDITS_PER_MINUTE

    // Find the workspace and wallet owner for this call
    const { data: callRecord } = await supabaseAdmin
      .from('calls')
      .select('workspace_id, from_number, to_number, direction')
      .eq('id', callId)
      .single()

    if (!callRecord?.workspace_id) {
      console.log('[call-billing] No workspace_id on call, skipping deduction')
      return
    }

    // Get workspace owner (wallet holder)
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('created_by')
      .eq('id', callRecord.workspace_id)
      .single()

    if (!workspace?.created_by) {
      console.log('[call-billing] No workspace owner found')
      return
    }

    const walletOwnerId = workspace.created_by
    const contactNumber = callRecord.direction === 'outbound' ? callRecord.to_number : callRecord.from_number
    const durationMins = Math.ceil(durationSeconds / 60)

    // Deduct credits using existing RPC (p_message_count accepts decimal)
    const { data: result, error } = await supabaseAdmin.rpc('deduct_message_cost', {
      p_user_id: walletOwnerId,
      p_workspace_id: callRecord.workspace_id,
      p_message_count: creditsToDeduct,
      p_cost_per_message: 0.03, // tracked for pricing tier reference
      p_description: `Call ${callRecord.direction === 'outbound' ? 'to' : 'from'} ${contactNumber} (${durationMins}m)`,
      p_campaign_id: null,
      p_message_id: null,
      p_recipient_phone: contactNumber
    })

    if (error) {
      console.error('[call-billing] Deduction error:', error.message)
      return
    }

    // Log to message_transactions for tracking
    await supabaseAdmin.from('message_transactions').insert({
      workspace_id: callRecord.workspace_id,
      user_id: walletOwnerId,
      campaign_id: null,
      message_id: null,
      recipient_phone: contactNumber,
      cost_per_message: 0.03,
      total_cost: creditsToDeduct * 0.03,
      message_type: 'call',
      status: 'sent'
    })

    console.log(`[call-billing] Deducted ${creditsToDeduct.toFixed(2)} credits for ${durationSeconds}s call (${durationMins}m). New balance: ${result?.new_balance}`)
  } catch (err) {
    console.error('[call-billing] Error:', err.message)
  }
}

export async function GET() {
  return NextResponse.json({ status: 'call webhook endpoint active' })
}
