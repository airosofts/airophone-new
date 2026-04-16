import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const { error } = await supabaseAdmin
      .from('phone_numbers')
      .update({ approval_notified_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId) // ensure ownership

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[dismiss-notification] Error:', error)
    return NextResponse.json({ error: 'Failed to dismiss' }, { status: 500 })
  }
}
