// Step 1 of VoiceDrop sender-number verification.
// Triggers a verification call to the user's phone number with a spoken code.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import { verifySenderInit } from '@/lib/voicedrop'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { phoneNumber } = await request.json().catch(() => ({}))
  if (!phoneNumber) {
    return NextResponse.json({ error: 'phoneNumber required' }, { status: 400 })
  }

  // Confirm this number belongs to the calling workspace
  const { data: pn } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, voicedrop_verified')
    .eq('phone_number', phoneNumber)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()

  if (!pn) {
    return NextResponse.json({ error: 'Phone number not found in this workspace' }, { status: 404 })
  }

  if (pn.voicedrop_verified) {
    return NextResponse.json({ success: true, alreadyVerified: true })
  }

  const result = await verifySenderInit(phoneNumber)
  if (!result.ok) {
    console.error('[voicedrop:verify-init]', result.status, result.data)
    return NextResponse.json(
      { error: result.data?.message || result.data?.error || 'VoiceDrop rejected the verification request' },
      { status: 400 }
    )
  }

  return NextResponse.json({ success: true, message: 'Verification call placed. Answer the call to receive the code.' })
}
