// POST /api/calls/fetch-recording
// Polls Telnyx for a call recording and stores the URL on the call record.
// Called client-side ~60s after a call ends as a fallback when the
// call.recording.saved webhook hasn't fired.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.TELNYX_API_KEY) {
    return NextResponse.json({ error: 'TELNYX_API_KEY not set' }, { status: 500 })
  }

  const { callControlId } = await request.json().catch(() => ({}))
  if (!callControlId) {
    return NextResponse.json({ error: 'callControlId required' }, { status: 400 })
  }

  // Find the call record to verify it belongs to this workspace
  const { data: callRecord } = await supabaseAdmin
    .from('calls')
    .select('id, recording_url, telnyx_call_id')
    .eq('telnyx_call_id', callControlId)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()

  if (!callRecord) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }

  // Already have a recording URL — nothing to do
  if (callRecord.recording_url) {
    return NextResponse.json({ success: true, recordingUrl: callRecord.recording_url, cached: true })
  }

  // Query Telnyx recordings API filtering by call_leg_id (= call_control_id for simple calls)
  const res = await fetch(
    `https://api.telnyx.com/v2/recordings?filter[call_leg_id]=${encodeURIComponent(callControlId)}&page[size]=1`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Accept': 'application/json',
      },
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[fetch-recording] Telnyx error:', res.status, JSON.stringify(err))
    return NextResponse.json({ found: false, error: `Telnyx ${res.status}` })
  }

  const data = await res.json()
  const recording = data.data?.[0]
  const recordingUrl = recording?.recording_urls?.mp3 || recording?.recording_urls?.wav || null

  if (!recordingUrl) {
    console.log('[fetch-recording] No recording yet for:', callControlId?.slice(0, 20))
    return NextResponse.json({ found: false })
  }

  // Store it on the call record
  await supabaseAdmin
    .from('calls')
    .update({ recording_url: recordingUrl, has_recording: true, updated_at: new Date().toISOString() })
    .eq('id', callRecord.id)

  console.log('[fetch-recording] Saved recording for call:', callRecord.id?.slice(0, 8))
  return NextResponse.json({ success: true, found: true, recordingUrl })
}
