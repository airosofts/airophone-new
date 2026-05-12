// Pulls the real delivery status for outbound messages still showing 'sent'/'sending'
// directly from Telnyx, so older messages where the webhook was missed get their
// true terminal state (delivered / failed / undelivered).
//
// Designed to be called when a conversation is opened — fast, async, and idempotent.

import { NextResponse } from 'next/server'
import axios from 'axios'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

const TELNYX_API = 'https://api.telnyx.com/v2'
const TELNYX_KEY = process.env.TELNYX_API_KEY

// Don't reconcile messages younger than this — they may still be in transit.
const MIN_AGE_SECONDS = 60

// Cap per-request work so a huge conversation doesn't time out / blow our Telnyx quota.
const MAX_BATCH = 50

// Map Telnyx's terminal recipient status → our message status column.
function mapTelnyxStatus(telnyxStatus) {
  switch (telnyxStatus) {
    case 'delivered':
      return { status: 'delivered', error: null }
    case 'sending_failed':
    case 'delivery_failed':
      return { status: 'failed', error: telnyxStatus }
    case 'delivery_unconfirmed':
      // Treat as failed for UI purposes — carriers that can't confirm are usually broken
      return { status: 'failed', error: 'delivery_unconfirmed' }
    case 'sent':
    case 'sending':
    case 'queued':
      return null // not terminal yet — leave alone
    default:
      return null
  }
}

export async function POST(request) {
  if (!TELNYX_KEY) {
    return NextResponse.json({ error: 'TELNYX_API_KEY not configured' }, { status: 500 })
  }

  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { conversationId, messageId } = body
  if (!conversationId && !messageId) {
    return NextResponse.json({ error: 'conversationId or messageId required' }, { status: 400 })
  }

  let stale
  if (messageId) {
    // Single-message reconcile (called from the message details modal)
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, telnyx_message_id, status, conversation_id')
      .eq('id', messageId)
      .single()
    if (!data) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    // Workspace check via the conversation
    const { data: convCheck } = await supabaseAdmin
      .from('conversations')
      .select('workspace_id')
      .eq('id', data.conversation_id)
      .single()
    if (convCheck?.workspace_id && convCheck.workspace_id !== user.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    stale = [data]
  } else {
    // Confirm the conversation belongs to this workspace before touching messages
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, workspace_id')
      .eq('id', conversationId)
      .single()

    if (!conv || (conv.workspace_id && conv.workspace_id !== user.workspaceId)) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Find outbound messages still in non-terminal state, older than MIN_AGE_SECONDS
    const cutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString()
    const { data: rows } = await supabaseAdmin
      .from('messages')
      .select('id, telnyx_message_id, status')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .in('status', ['sent', 'sending'])
      .lt('created_at', cutoff)
      .not('telnyx_message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_BATCH)
    stale = rows || []
  }

  if (!stale?.length) {
    return NextResponse.json({ success: true, checked: 0, updated: 0, results: [] })
  }

  const settled = await Promise.allSettled(
    stale.map(async (msg) => {
      try {
        const res = await axios.get(`${TELNYX_API}/messages/${msg.telnyx_message_id}`, {
          headers: { Authorization: `Bearer ${TELNYX_KEY}` },
          timeout: 10000,
        })
        const telnyxStatus = res.data?.data?.to?.[0]?.status
        const errors = res.data?.data?.errors || []
        const mapped = mapTelnyxStatus(telnyxStatus)

        if (!mapped) {
          return { id: msg.id, telnyx_status: telnyxStatus, action: 'skipped_non_terminal' }
        }

        const update = { status: mapped.status }
        if (mapped.status === 'delivered') {
          update.delivered_at = new Date().toISOString()
          update.error_code = null
          update.error_message = null
          update.error_details = null
        }
        if (mapped.status === 'failed' && mapped.error) {
          const carrierErr = errors[0]
          const code = String(carrierErr?.code || mapped.error)
          const msg = carrierErr?.title || carrierErr?.detail || (
              mapped.error === 'sending_failed'   ? 'Carrier rejected the message'
            : mapped.error === 'delivery_failed'  ? 'Could not be delivered to recipient'
            : mapped.error === 'delivery_unconfirmed' ? 'Delivery could not be confirmed by carrier'
            : `Final status: ${mapped.error}`)
          update.error_code = code
          update.error_message = msg
          update.error_details = JSON.stringify({
            error_code: code,
            error_message: msg,
            reconciled_at: new Date().toISOString(),
          })
        }

        await supabaseAdmin.from('messages').update(update).eq('id', msg.id)
        return { id: msg.id, telnyx_status: telnyxStatus, new_status: mapped.status, action: 'updated' }
      } catch (err) {
        const code = err.response?.status
        if (code === 404) {
          // Telnyx no longer has the record (older than their retention window).
          // Record this on the message so the UI shows "couldn't verify" instead
          // of misleadingly displaying "Sent".
          const expiredMsg = 'Delivery status unavailable — Telnyx no longer has this record (>10 days old)'
          await supabaseAdmin
            .from('messages')
            .update({
              error_code: 'telnyx_record_expired',
              error_message: expiredMsg,
              error_details: JSON.stringify({
                error_code: 'telnyx_record_expired',
                error_message: expiredMsg,
                reconciled_at: new Date().toISOString(),
              }),
            })
            .eq('id', msg.id)
            .is('error_code', null) // only tag if not already tagged — don't overwrite real errors
          return { id: msg.id, action: 'telnyx_404', note: 'record expired' }
        }
        console.error(`[reconcile-status] ${msg.id} → ${code || 'no-status'}: ${err.message}`)
        return { id: msg.id, action: 'error', code, error: err.message }
      }
    })
  )

  const results = settled.map(r => r.status === 'fulfilled' ? r.value : { action: 'rejected', error: r.reason?.message })
  const updated = results.filter(r => r.action === 'updated').length
  const expired = results.filter(r => r.action === 'telnyx_404').length
  const errored = results.filter(r => r.action === 'error' || r.action === 'rejected').length

  return NextResponse.json({
    success: true,
    checked: stale.length,
    updated,
    expired,
    errored,
    results,
  })
}
