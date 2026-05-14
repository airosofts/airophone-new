// Uploads audio for RVM campaigns.
// 1. Stores the file in Supabase Storage (for in-app playback in the chat window)
// 2. Uploads the same file to VoiceDrop's S3 via POST /upload-static-audio
//    → returns their permanent CDN URL as `voicedrop_url` so RVM sends never
//      depend on Supabase bucket permissions.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest, getUserFromRequest } from '@/lib/session-helper'
import { uploadAudio } from '@/lib/voicedrop'

const ALLOWED_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac'])
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB' }, { status: 400 })
  }

  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
  }

  const ext = (file.name || 'audio.mp3').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
  const random = Math.random().toString(36).slice(2, 10)
  const storagePath = `${workspace.workspaceId}/${Date.now()}_${random}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  // 1. Store in Supabase for in-app audio playback
  const { error: storageErr } = await supabaseAdmin.storage
    .from('voicemails')
    .upload(storagePath, buffer, { contentType: file.type || 'audio/mpeg', upsert: false })

  if (storageErr) {
    console.error('[voicemails:upload] supabase error', storageErr)
    return NextResponse.json({ error: storageErr.message || 'Upload failed' }, { status: 500 })
  }

  // Signed URL for in-app playback (7 days — refreshed at campaign launch anyway)
  const { data: signed } = await supabaseAdmin.storage
    .from('voicemails')
    .createSignedUrl(storagePath, 604800)
  const playbackUrl = signed?.signedUrl || ''

  // 2. Upload to VoiceDrop's own S3 so their servers can always fetch the audio
  let voicedropUrl = null
  try {
    voicedropUrl = await uploadAudio(buffer, file.name || `voicemail.${ext}`, file.type || 'audio/mpeg')
    console.log('[voicemails:upload] VoiceDrop S3 upload success:', voicedropUrl)
  } catch (e) {
    console.error('[voicemails:upload] VoiceDrop S3 upload failed — will fall back to signed URL at send time:', e.message)
  }

  console.log('[voicemails:upload] complete', {
    storagePath,
    hasVoicedropUrl: !!voicedropUrl,
    playbackUrlOk: !!playbackUrl,
    sizeBytes: file.size,
  })

  return NextResponse.json({
    success: true,
    url: playbackUrl,            // used for in-app audio player
    voicedrop_url: voicedropUrl, // used as recording_url when sending RVMs
    path: storagePath,
    sizeBytes: file.size,
  })
}
