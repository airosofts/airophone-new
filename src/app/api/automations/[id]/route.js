// Monday automation — edit / toggle / delete.
//   PATCH  /api/automations/[id]
//     - { is_active }                                    → pause/resume
//     - { name, phone_column_id, message_mode, message_template, ai_instructions,
//         sender_phone_number_id, send_delay_seconds, respect_business_hours } → edit
//     board_id, trigger_event and monday_webhook_id are intentionally NOT editable
//     here — changing those means recreating the Monday webhook, so the user
//     deletes and re-adds the automation in that case.
//   DELETE /api/automations/[id]  → removes the row + the Monday webhook

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { deleteWebhook } from '@/lib/monday'

const VALID_MODES = ['template', 'ai']
const MAX_DELAY_SEC = 7 * 24 * 60 * 60

async function loadOwned(id, workspaceId) {
  const { data } = await supabaseAdmin
    .from('monday_automations')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data
}

export async function PATCH(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const automation = await loadOwned(id, user.workspaceId)
  if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const update = { updated_at: new Date().toISOString() }

  // Build the update object from whichever editable fields the client sent.
  // Anything not present is left unchanged.
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active

  if (typeof body.name === 'string') {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    update.name = n
  }
  if (typeof body.phone_column_id === 'string' && body.phone_column_id.trim()) {
    update.phone_column_id = body.phone_column_id.trim()
  }
  if (typeof body.sender_phone_number_id === 'string' && body.sender_phone_number_id.trim()) {
    update.sender_phone_number_id = body.sender_phone_number_id.trim()
  }
  if (body.send_delay_seconds !== undefined) {
    const n = Number(body.send_delay_seconds)
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'send_delay_seconds must be a non-negative number' }, { status: 400 })
    update.send_delay_seconds = Math.min(MAX_DELAY_SEC, Math.floor(n))
  }
  if (typeof body.respect_business_hours === 'boolean') {
    update.respect_business_hours = body.respect_business_hours
    update.business_hours_mode = body.respect_business_hours ? 'within' : 'anytime'
  }
  if (body.business_hours_mode !== undefined) {
    if (!['anytime', 'within', 'outside'].includes(body.business_hours_mode)) {
      return NextResponse.json({ error: 'business_hours_mode must be anytime, within, or outside' }, { status: 400 })
    }
    update.business_hours_mode = body.business_hours_mode
    update.respect_business_hours = body.business_hours_mode === 'within'   // keep legacy column in sync
  }

  // Message mode + content are coupled — if mode is changing, set the matching
  // content column and null the other one so stale values don't linger.
  if (typeof body.message_mode === 'string') {
    if (!VALID_MODES.includes(body.message_mode)) {
      return NextResponse.json({ error: 'Invalid message_mode' }, { status: 400 })
    }
    update.message_mode = body.message_mode
    if (body.message_mode === 'template') {
      const t = String(body.message_template || '').trim()
      if (!t) return NextResponse.json({ error: 'message_template is required for template mode' }, { status: 400 })
      update.message_template = t
      update.ai_instructions = null
    } else {
      const ai = String(body.ai_instructions || '').trim()
      if (!ai) return NextResponse.json({ error: 'ai_instructions are required for ai mode' }, { status: 400 })
      update.ai_instructions = ai
      update.message_template = null
    }
  } else {
    // Mode unchanged — allow editing just the body of the current mode.
    if (typeof body.message_template === 'string' && automation.message_mode === 'template') {
      update.message_template = body.message_template.trim()
    }
    if (typeof body.ai_instructions === 'string' && automation.message_mode === 'ai') {
      update.ai_instructions = body.ai_instructions.trim()
    }
  }

  const { data, error } = await supabaseAdmin
    .from('monday_automations')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[automations PATCH] db error:', error)
    return NextResponse.json({ error: 'Failed to update automation' }, { status: 500 })
  }
  return NextResponse.json({ success: true, automation: data })
}

export async function DELETE(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const automation = await loadOwned(id, user.workspaceId)
  if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 })

  // Remove the webhook from Monday — best-effort. If it fails (token expired,
  // webhook already gone) we still delete our row; a dangling Monday webhook
  // just posts events we'll ignore (no matching automation).
  if (automation.monday_webhook_id) {
    try {
      await deleteWebhook(user.workspaceId, automation.monday_webhook_id)
    } catch (err) {
      console.warn('[automations DELETE] could not delete Monday webhook:', err.message)
    }
  }

  const { error } = await supabaseAdmin
    .from('monday_automations')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[automations DELETE] db error:', error)
    return NextResponse.json({ error: 'Failed to delete automation' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
