// Monday automation — toggle active / delete.
//   PATCH  /api/automations/[id]  → { is_active }
//   DELETE /api/automations/[id]  → removes the row + the Monday webhook

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { deleteWebhook } from '@/lib/monday'

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

  const { is_active } = await request.json()
  const { error } = await supabaseAdmin
    .from('monday_automations')
    .update({ is_active: !!is_active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('[automations PATCH] db error:', error)
    return NextResponse.json({ error: 'Failed to update automation' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
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
