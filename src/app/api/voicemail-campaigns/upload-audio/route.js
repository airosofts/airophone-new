// Uploads an .mp3 to the public-read `voicemails` bucket in Supabase Storage.
// Returns the public URL we'll pass to VoiceDrop as `recording_url`.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest, getUserFromRequest } from '@/lib/session-helper'

const ALLOWED_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac'])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — matches VoiceDrop's stated limit

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

  // Use a workspace-scoped path; random suffix prevents collisions across uploads.
  const ext = (file.name || 'audio.mp3').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
  const random = Math.random().toString(36).slice(2, 10)
  const path = `${workspace.workspaceId}/${Date.now()}_${random}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { error } = await supabaseAdmin.storage
    .from('voicemails')
    .upload(path, buffer, {
      contentType: file.type || 'audio/mpeg',
      upsert: false,
    })

  if (error) {
    console.error('[voicemails:upload]', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }

  // Return a signed URL (7 days) so the upload UI can preview the audio immediately,
  // and the path so campaign launch can regenerate a fresh signed URL each time.
  const { data: signed } = await supabaseAdmin.storage
    .from('voicemails')
    .createSignedUrl(path, 604800)

  return NextResponse.json({
    success: true,
    url: signed?.signedUrl || '',
    path,
    sizeBytes: file.size,
  })
}
