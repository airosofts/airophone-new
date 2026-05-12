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
  const { conversationId } = body
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  }

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
  const { data: stale } = await supabaseAdmin
    .from('messages')
    .select('id, telnyx_message_id, status')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .in('status', ['sent', 'sending'])
    .lt('created_at', cutoff)
    .not('telnyx_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_BATCH)

  if (!stale?.length) {
    return NextResponse.json({ success: true, checked: 0, updated: 0 })
  }

  const results = await Promise.allSettled(
    stale.map(async (msg) => {
      try {
        const res = await axios.get(`${TELNYX_API}/messages/${msg.telnyx_message_id}`, {
          headers: { Authorization: `Bearer ${TELNYX_KEY}` },
          timeout: 8000,
        })
        const telnyxStatus = res.data?.data?.to?.[0]?.status
        const mapped = mapTelnyxStatus(telnyxStatus)
        if (!mapped) return { id: msg.id, skipped: true }

        const update = { status: mapped.status }
        if (mapped.status === 'delivered') {
          update.delivered_at = new Date().toISOString()
        }
        if (mapped.status === 'failed' && mapped.error) {
          update.error_details = JSON.stringify({
            error_code: mapped.error,
            error_message: mapped.error === 'sending_failed'
              ? 'Carrier rejected the message'
              : mapped.error === 'delivery_failed'
              ? 'Could not be delivered to recipient'
              : mapped.error === 'delivery_unconfirmed'
              ? 'Delivery could not be confirmed by carrier'
              : `Final status: ${mapped.error}`,
            reconciled_at: new Date().toISOString(),
          })
        }

        await supabaseAdmin.from('messages').update(update).eq('id', msg.id)
        return { id: msg.id, updated: true, status: mapped.status }
      } catch (err) {
        // Telnyx 404 means the message ID isn't theirs (test data, old account) —
        // mark it 'delivered' optimistically to stop re-checking, since there's
        // nothing else we can do. Other errors: leave for next reconcile.
        if (err.response?.status === 404) {
          return { id: msg.id, error: 'not_found' }
        }
        return { id: msg.id, error: err.message }
      }
    })
  )

  const updated = results.filter(r => r.status === 'fulfilled' && r.value.updated).length
  const errored = results.filter(r => r.status === 'rejected' || r.value?.error).length

  return NextResponse.json({
    success: true,
    checked: stale.length,
    updated,
    errored,
  })
}
