// Audio Library for RVM — list + save reusable voicemail recordings per workspace.
//
// GET  → list the workspace's saved recordings (newest first). Playback URLs are
//        RE-SIGNED from storage_path on every read, since signed URLs expire.
// POST → save a recording to the library (called after a successful upload).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const SIGNED_URL_TTL = 604800   // 7 days

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('voicemail_recordings')
    .select('*')
    .eq('workspace_id', workspace.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[voicemail-recordings:GET]', error)
    return NextResponse.json({ error: 'Failed to fetch recordings' }, { status: 500 })
  }

  // Re-sign playback URLs so the in-app player always works (the stored
  // playback_url may have expired). voicedrop_url is permanent and untouched.
  const recordings = await Promise.all((data || []).map(async (r) => {
    let playbackUrl = r.playback_url
    if (r.storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from('voicemails')
        .createSignedUrl(r.storage_path, SIGNED_URL_TTL)
      if (signed?.signedUrl) playbackUrl = signed.signedUrl
    }
    return {
      id: r.id,
      name: r.name,
      url: playbackUrl,            // for the in-app audio player
      voicedrop_url: r.voicedrop_url,
      path: r.storage_path,
      duration_seconds: r.duration_seconds,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
    }
  }))

  return NextResponse.json({ success: true, recordings })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { name, storagePath, playbackUrl, voicedropUrl, durationSeconds, sizeBytes } = body

  // A recording needs a name and at least one fetchable URL (VoiceDrop's S3 URL
  // is what actually gets sent; the storage path backs in-app playback).
  if (!name || (!voicedropUrl && !storagePath)) {
    return NextResponse.json({ error: 'name and a recording source are required' }, { status: 400 })
  }

  // De-dupe: if this exact audio is already saved (same VoiceDrop URL or storage
  // path), return the existing row instead of creating a duplicate library entry.
  if (voicedropUrl || storagePath) {
    const { data: existing } = await supabaseAdmin
      .from('voicemail_recordings')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .or([
        voicedropUrl ? `voicedrop_url.eq.${voicedropUrl}` : null,
        storagePath ? `storage_path.eq.${storagePath}` : null,
      ].filter(Boolean).join(','))
      .maybeSingle()
    if (existing) return NextResponse.json({ success: true, recording: existing, deduped: true })
  }

  const { data: recording, error } = await supabaseAdmin
    .from('voicemail_recordings')
    .insert({
      workspace_id: workspace.workspaceId,
      created_by: user.userId,
      name: String(name).slice(0, 200),
      storage_path: storagePath || null,
      playback_url: playbackUrl || null,
      voicedrop_url: voicedropUrl || null,
      duration_seconds: Number.isFinite(Number(durationSeconds)) ? Math.round(Number(durationSeconds)) : null,
      size_bytes: Number.isFinite(Number(sizeBytes)) ? Math.round(Number(sizeBytes)) : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[voicemail-recordings:POST]', error)
    return NextResponse.json({ error: 'Failed to save recording' }, { status: 500 })
  }

  return NextResponse.json({ success: true, recording })
}
