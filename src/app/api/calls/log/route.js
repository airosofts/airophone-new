// POST /api/calls/log - Log a call from the WebRTC UI (inbound or outbound).
// Acts as a reliable client-side fallback for the Telnyx call webhook.
// Deduplicates against any record the webhook may have already created.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+1${digits}`
}

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      console.log('[calls/log] 401 — no user in request headers')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { direction = 'outbound', toNumber, fromNumber, callControlId, conversationId, answeredAt, endedAt, durationSeconds } = await request.json()

    console.log('[calls/log] received', { direction, fromNumber, toNumber, answeredAt: !!answeredAt, workspaceId: user.workspaceId })

    if (!toNumber || !fromNumber) {
      return NextResponse.json({ error: 'toNumber and fromNumber required' }, { status: 400 })
    }

    const supabase = createSupabaseServerClient()
    const normalizedTo = normalizePhoneNumber(toNumber)
    const normalizedFrom = normalizePhoneNumber(fromNumber)

    // For conversation lookup:
    //   outbound → contact = to, our line = from
    //   inbound  → contact = from, our line = to
    const contactNumber = direction === 'inbound' ? normalizedFrom : normalizedTo
    const ourNumber = direction === 'inbound' ? normalizedTo : normalizedFrom

    // Find or create conversation
    let convId = conversationId
    if (!convId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('phone_number', contactNumber)
        .eq('from_number', ourNumber)
        .maybeSingle()

      if (existing) {
        convId = existing.id
      } else {
        const { data: created } = await supabase
          .from('conversations')
          .insert({
            phone_number: contactNumber,
            from_number: ourNumber,
            workspace_id: user.workspaceId,
            status: 'open',
            last_message_at: endedAt || new Date().toISOString(),
          })
          .select('id')
          .single()
        convId = created?.id
      }
    }

    // Bump conversation last_message_at so call bubbles to top of inbox
    if (convId) {
      await supabase
        .from('conversations')
        .update({ last_message_at: endedAt || new Date().toISOString() })
        .eq('id', convId)
    }

    const fromDigits = normalizedFrom?.replace(/\D/g, '').slice(-10)
    const toDigits = normalizedTo?.replace(/\D/g, '').slice(-10)
    const windowStart = new Date(Date.now() - 300000).toISOString() // 5-min dedup window

    // Check if the Telnyx webhook already created a record for this call
    const { data: existing } = await supabase
      .from('calls')
      .select('id, conversation_id')
      .eq('direction', direction)
      .like('from_number', `%${fromDigits}`)
      .like('to_number', `%${toDigits}`)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Webhook already created the record — patch it with final details
      const updates = { conversation_id: convId, user_id: user.userId }
      if (answeredAt) updates.answered_at = answeredAt
      if (endedAt) updates.ended_at = endedAt
      if (durationSeconds > 0) updates.duration_seconds = durationSeconds
      if (answeredAt) updates.status = 'completed'
      else updates.status = 'missed'

      await supabase.from('calls').update(updates).eq('id', existing.id)
      return NextResponse.json({ success: true, callId: existing.id, conversationId: convId, deduplicated: true })
    }

    // No webhook record — create one now
    const status = answeredAt ? 'completed' : 'missed'
    const { data: call, error } = await supabase
      .from('calls')
      .insert({
        telnyx_call_id: callControlId || `webrtc_${Date.now()}`,
        from_number: normalizedFrom,
        to_number: normalizedTo,
        direction,
        status,
        answered_at: answeredAt || null,
        ended_at: endedAt || null,
        duration_seconds: durationSeconds > 0 ? durationSeconds : null,
        workspace_id: user.workspaceId,
        user_id: user.userId,
        conversation_id: convId,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error && error.code !== '23505') {
      console.error('[calls/log] Insert error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, callId: call?.id, conversationId: convId })
  } catch (error) {
    console.error('[calls/log] Error:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
