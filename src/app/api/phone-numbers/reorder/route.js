// Persist the sidebar drag order for phone numbers (workspace-shared).
// Body: { order: [phoneId, phoneId, ...] } — index becomes sort_order.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const order = Array.isArray(body?.order) ? body.order : null
  if (!order) return NextResponse.json({ error: 'order array required' }, { status: 400 })

  // Update each id's sort_order to its position. Scoped to the workspace so a
  // caller can't reorder another workspace's numbers.
  await Promise.all(order.map((id, i) =>
    supabaseAdmin
      .from('phone_numbers')
      .update({ sort_order: i })
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
  ))

  return NextResponse.json({ success: true })
}
