// Scheduled / send-later SMS — create, list (per conversation), and cancel.
// The actual sending happens in /api/sms/process-scheduled (driven by followup-cron).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const VALID_CONDITIONS = ['always', 'unless_first']

// POST — schedule a message for later.
export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { from, to, message, mediaUrls, conversationId, scheduledAt, timezone, condition } = body

  const media = (Array.isArray(mediaUrls) ? mediaUrls : [])
    .map(m => (typeof m === 'string' ? { url: m, type: null } : m))
    .filter(m => m && m.url)

  if (!from || !to || (!message && media.length === 0)) {
    return NextResponse.json({ error: 'Missing from, to, and a message or attachment' }, { status: 400 })
  }
  const when = scheduledAt ? new Date(scheduledAt) : null
  if (!when || isNaN(when.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduled time' }, { status: 400 })
  }
  if (when.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'Scheduled time is in the past' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('scheduled_messages')
    .insert({
      workspace_id: workspace.workspaceId,
      conversation_id: conversationId || null,
      from_number: normalizePhoneNumber(from),
      to_number: normalizePhoneNumber(to),
      body: message || '',
      media_urls: media.length ? media : null,
      scheduled_at: when.toISOString(),
      timezone: timezone || null,
      condition: VALID_CONDITIONS.includes(condition) ? condition : 'always',
      status: 'scheduled',
      created_by: user?.userId || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[sms/schedule] insert error:', error)
    return NextResponse.json({ error: 'Failed to schedule message' }, { status: 500 })
  }
  return NextResponse.json({ success: true, scheduled: data })
}

// GET ?conversationId= — list pending scheduled messages for a conversation.
export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('conversationId')

  let q = supabaseAdmin
    .from('scheduled_messages')
    .select('*')
    .eq('workspace_id', workspace.workspaceId)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true })
  if (conversationId) q = q.eq('conversation_id', conversationId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  return NextResponse.json({ scheduled: data || [] })
}

// DELETE ?id= — cancel a scheduled message.
export async function DELETE(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('scheduled_messages')
    .update({ status: 'canceled', cancel_reason: 'user_canceled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspace.workspaceId)
    .eq('status', 'scheduled')
  if (error) return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
  return NextResponse.json({ success: true })
}
