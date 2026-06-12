// Upload an MMS attachment (image/video) to public Supabase storage and return
// a public URL that Telnyx can fetch when sending the MMS.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const BUCKET = 'assets'                 // public bucket — Telnyx must reach the URL
const MAX_BYTES = 20 * 1024 * 1024      // 20 MB ceiling (carriers cap lower, but allow)
const ALLOWED = /^(image|video)\//

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
  const type = file.type || 'application/octet-stream'
  if (!ALLOWED.test(type)) {
    return NextResponse.json({ error: 'Only image and video files are supported' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 })
  }

  const ext = ((file.name?.split('.').pop()) || type.split('/')[1] || 'bin')
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  const path = `mms/${workspace.workspaceId}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

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
