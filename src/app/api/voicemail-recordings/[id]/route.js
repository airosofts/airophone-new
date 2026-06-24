// Delete a saved RVM recording from the workspace's Audio Library.
// Removes the library row; the underlying storage object is left in place since
// past campaigns may still reference it for playback.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function DELETE(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { error } = await supabaseAdmin
    .from('voicemail_recordings')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.workspaceId)   // scope to caller's workspace

  if (error) {
    console.error('[voicemail-recordings:DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete recording' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
