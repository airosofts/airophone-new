// Step 2 — user submits the code they heard during the verification call.
// On success, flip phone_numbers.voicedrop_verified = true so the number can
// be used as an RVM sender without re-verifying.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import { verifySenderConfirm } from '@/lib/voicedrop'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { phoneNumber, code } = await request.json().catch(() => ({}))
  if (!phoneNumber || !code) {
    return NextResponse.json({ error: 'phoneNumber and code are required' }, { status: 400 })
  }

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

  const result = await verifySenderConfirm(phoneNumber, code)
  console.log('[voicedrop:verify-confirm]', {
    phoneNumber,
    httpOk: result.ok,
    httpStatus: result.status,
    response: result.data,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.data?.message || result.data?.error || 'Invalid or expired verification code' },
      { status: 400 }
    )
  }

  await supabaseAdmin
    .from('phone_numbers')
    .update({
      voicedrop_verified: true,
      voicedrop_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pn.id)

  console.log('[voicedrop:verify-confirm] SUCCESS — number marked verified in DB:', phoneNumber)
  return NextResponse.json({ success: true })
}
