// Delete every contact in the workspace whose phone is in `phones` — used to
// purge landlines from contacts + all their lists after a landline scan.
// Handles the RESTRICT foreign keys (campaign_messages.contact_id,
// voicemail_campaign_sends.contact_id) by removing those referencing rows first.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const phones = [...new Set((Array.isArray(body.phones) ? body.phones : []).filter(p => typeof p === 'string' && p.length >= 8))]
  if (phones.length === 0) return NextResponse.json({ error: 'No numbers provided' }, { status: 400 })

  // Resolve contact ids for these numbers in this workspace.
  const ids = []
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('contacts').select('id')
      .eq('workspace_id', workspace.workspaceId)
      .in('phone_number', phones.slice(i, i + 200))
    for (const r of (data || [])) ids.push(r.id)
  }
  if (ids.length === 0) return NextResponse.json({ success: true, deleted: 0 })

  // Clear the RESTRICT references first (these are landlines being purged —
  // their campaign/send history goes with them), then delete the contacts.
  let deleted = 0
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    await supabaseAdmin.from('voicemail_campaign_sends').delete().in('contact_id', chunk)
    await supabaseAdmin.from('campaign_messages').delete().in('contact_id', chunk)
    const { error } = await supabaseAdmin
      .from('contacts').delete()
      .eq('workspace_id', workspace.workspaceId)
      .in('id', chunk)
    if (error) {
      console.error('[bulk-delete-by-phone] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete contacts', details: error.message, deleted }, { status: 500 })
    }
    deleted += chunk.length
  }

  return NextResponse.json({ success: true, deleted })
}
