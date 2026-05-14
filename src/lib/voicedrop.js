// Thin wrapper around VoiceDrop's REST API.
// Auth: `auth-key` header. Base: https://api.voicedrop.ai/v1
//
// Endpoints used:
//   POST /upload-static-audio    — upload .mp3 to VoiceDrop's S3, returns permanent URL
//   POST /sender-numbers/verify  — two-step phone verification
//   POST /ringless_voicemail      — send a Static Audio RVM

const VOICEDROP_BASE = process.env.VOICEDROP_API_URL || 'https://api.voicedrop.ai/v1'
const VOICEDROP_KEY  = process.env.VOICEDROP_API_KEY

function requireKey() {
  if (!VOICEDROP_KEY) throw new Error('VOICEDROP_API_KEY is not set')
}

// Normalize a phone number → "8382048923" (10 digits, no + or country code).
function toLocalDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

async function vdPost(path, body) {
  requireKey()
  const res = await fetch(`${VOICEDROP_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'auth-key': VOICEDROP_KEY,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// Upload an audio file directly to VoiceDrop's S3.
// Returns their permanent CDN URL — use this as recording_url for RVM sends
// so VoiceDrop never has to fetch from your own storage.
//
// audioBuffer — Uint8Array / Buffer of the audio file
// filename    — e.g. "voicemail.mp3"
// contentType — e.g. "audio/mpeg"
export async function uploadAudio(audioBuffer, filename = 'voicemail.mp3', contentType = 'audio/mpeg') {
  requireKey()
  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: contentType }), filename)

  const res = await fetch(`${VOICEDROP_BASE}/upload-static-audio`, {
    method: 'POST',
    headers: { 'auth-key': VOICEDROP_KEY },
    body: form,
  })
  const data = await res.json().catch(() => ({}))

  console.log('[voicedrop:upload]', { httpOk: res.ok, httpStatus: res.status, response: data })

  if (!res.ok || data.status !== 'success') {
    throw new Error(data?.message || `VoiceDrop upload failed (HTTP ${res.status})`)
  }

  // Response: { status: "success", message: { recording_url: "https://voicedrop-ai.s3..." } }
  const url = data.message?.recording_url
  if (!url) throw new Error('VoiceDrop upload succeeded but returned no recording_url')
  return url
}

// Step 1 — ask VoiceDrop to call the phone with a verification code.
export async function verifySenderInit(phoneNumber) {
  return vdPost('/sender-numbers/verify', {
    phone_number: toLocalDigits(phoneNumber),
    method: 'call',
  })
}

// Step 2 — submit the code the user heard during the verification call.
export async function verifySenderConfirm(phoneNumber, code) {
  return vdPost('/sender-numbers/verify', {
    phone_number: toLocalDigits(phoneNumber),
    code: String(code).trim(),
  })
}

// Send a Ringless Voicemail using a pre-recorded audio file.
// recordingUrl must be publicly accessible — use uploadAudio() to get a VoiceDrop-hosted URL.
// VoiceDrop's /ringless_voicemail response has no job ID; delivery status arrives via webhook only.
export async function sendStaticVoicemail({ recordingUrl, from, to, statusWebhookUrl }) {
  const result = await vdPost('/ringless_voicemail', {
    recording_url: recordingUrl,
    from: toLocalDigits(from),
    to: toLocalDigits(to),
    validate_recipient_phone: false,
    send_status_to_webhook: statusWebhookUrl || undefined,
  })

  console.log('[voicedrop:send]', {
    to: toLocalDigits(to),
    from: toLocalDigits(from),
    httpOk: result.ok,
    httpStatus: result.status,
    response: result.data,
  })

  // success = HTTP 200 + status:"success" in body
  if (result.ok && result.data?.status !== 'success') {
    result.ok = false
  }

  return result
}
