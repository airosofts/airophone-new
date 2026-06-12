// Upload an MMS attachment (image/video/audio) to public Supabase storage and
// return a public URL that Telnyx can fetch when sending the MMS. Audio is used
// for voice messages recorded in the composer.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const BUCKET = 'assets'                 // public bucket — Telnyx must reach the URL
const MAX_BYTES = 20 * 1024 * 1024      // 20 MB ceiling (carriers cap lower, but allow)
const ALLOWED = /^(image|video|audio)\//

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  let type = file.type || 'application/octet-stream'
  if (!ALLOWED.test(type)) {
    return NextResponse.json({ error: 'Only image, video, and audio files are supported' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 })
  }

  let buffer = Buffer.from(await file.arrayBuffer())

  // Carriers (and apps like OpenPhone) don't reliably render WebP/BMP over MMS,
  // even though Telnyx accepts them. Transcode those to JPEG and cap dimensions
  // so we stay well under the ~1 MB MMS image limit. JPEG/PNG/GIF pass through.
  if (type === 'image/webp' || type === 'image/bmp') {
    try {
      const sharp = (await import('sharp')).default
      buffer = await sharp(buffer)
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer()
      type = 'image/jpeg'
    } catch (e) {
      console.error('[upload-media] webp/bmp transcode failed, keeping original:', e.message)
    }
  }

  const ext = (type.split('/')[1] || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  const path = `mms/${workspace.workspaceId}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: type, upsert: false })
  if (error) {
    console.error('[upload-media] storage error:', error)
    return NextResponse.json({ error: 'Upload failed: ' + error.message }, { status: 500 })
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ success: true, url: data.publicUrl, type })
}
