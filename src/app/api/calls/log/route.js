// POST /api/calls/log - Log an outbound call made from the WebRTC UI
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { toNumber, fromNumber, callControlId, conversationId } = await request.json()

    if (!toNumber || !fromNumber) {
      return NextResponse.json({ error: 'toNumber and fromNumber required' }, { status: 400 })
    }

    const supabase = createSupabaseServerClient()
    const normalizedTo = normalizePhoneNumber(toNumber)
    const normalizedFrom = normalizePhoneNumber(fromNumber)

    // Find or create conversation
    let convId = conversationId
    if (!convId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('phone_number', normalizedTo)
        .eq('from_number', normalizedFrom)
        .maybeSingle()

      if (existing) {
        convId = existing.id
      } else {
        const { data: created } = await supabase
          .from('conversations')
          .insert({
            phone_number: normalizedTo,
            from_number: normalizedFrom,
            workspace_id: user.workspaceId,
            status: 'open',
            last_message_at: new Date().toISOString()
          })
          .select('id')
          .single()
        convId = created?.id
      }
    }

    // Check for existing recent call (within 10 seconds) to same number to avoid duplicates
    // The webhook may create a record with a different telnyx_call_id than the WebRTC call.id
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString()
    const fromDigits = normalizedFrom?.replace(/\D/g, '').slice(-10)
    const toDigits = normalizedTo?.replace(/\D/g, '').slice(-10)

    const { data: recentCall } = await supabase
      .from('calls')
      .select('id')
      .eq('direction', 'outbound')
      .like('from_number', `%${fromDigits}`)
      .like('to_number', `%${toDigits}`)
      .gte('created_at', tenSecondsAgo)
      .limit(1)
      .maybeSingle()

    if (recentCall) {
      // Update existing record with conversation_id
      await supabase.from('calls')
        .update({ conversation_id: convId })
        .eq('id', recentCall.id)
        .is('conversation_id', null)

      return NextResponse.json({ success: true, callId: recentCall.id, conversationId: convId, deduplicated: true })
    }

    // Insert new call record
    const { data: call, error } = await supabase
      .from('calls')
      .insert({
        telnyx_call_id: callControlId || `webrtc_${Date.now()}`,
        from_number: normalizedFrom,
        to_number: normalizedTo,
        direction: 'outbound',
        status: 'initiated',
        workspace_id: user.workspaceId,
        conversation_id: convId,
        created_at: new Date().toISOString()
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
