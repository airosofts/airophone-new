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

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Is this a connection-level failure (never reached the provider) vs. an HTTP
// rejection? Connection failures are transient and worth an immediate re-try.
function isConnError(err) {
  const cause = err?.cause?.code || err?.code || ''
  return /fetch failed|timeout|socket|network|aborted/i.test(err?.message || '')
    || ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(cause)
}

// fetch() with a hard per-try timeout + a couple of quick retries on
// connection-level errors. The voicemail provider sits behind AWS API Gateway
// and occasionally refuses/slows new connections from a container; retrying
// within the same call usually catches a good moment instead of failing the
// whole send. HTTP responses (even 4xx/5xx) are returned as-is — only genuine
// connection failures are retried here.
async function fetchResilient(url, options, { tries = 3, timeoutMs = 15000, backoffMs = 600 } = {}) {
  let lastErr
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(url, { ...options, signal: ctrl.signal })
    } catch (err) {
      lastErr = err
      if (!isConnError(err) || attempt === tries) throw err
      console.warn('[voicedrop] connection error, retrying', { url, attempt, cause: err?.cause?.code || err?.message })
      await sleep(backoffMs * attempt)   // 600ms, 1200ms …
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

// Normalize a phone number → "8382048923" (10 digits, no + or country code).
// Used for the /sender-numbers/verify endpoint.
function toLocalDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

// Normalize a phone number → E.164 "+18382048923".
// VoiceDrop's /ringless_voicemail API rejects bare digits with "Invalid payload"
// — it requires E.164. Sending "8382048923" was the cause of the delivery failures.
function toE164(phone) {
  const raw = String(phone || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `+1${digits}`              // US 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}` // US with country code
  return raw.startsWith('+') ? `+${digits}` : `+${digits}`    // already international / other
}

async function vdPost(path, body) {
  requireKey()
  const res = await fetchResilient(`${VOICEDROP_BASE}${path}`, {
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

  const res = await fetchResilient(`${VOICEDROP_BASE}/upload-static-audio`, {
    method: 'POST',
    headers: { 'auth-key': VOICEDROP_KEY },
    body: form,
  }, { tries: 3, timeoutMs: 30000 })   // uploads are larger — allow more time
  const data = await res.json().catch(() => ({}))

  console.log('[voicedrop:upload]', { httpOk: res.ok, httpStatus: res.status, response: data })

  if (!res.ok || data.status !== 'success') {
    throw new Error(data?.message || `Voicemail audio upload failed (HTTP ${res.status})`)
  }

  // Response: { status: "success", message: { recording_url: "https://voicedrop-ai.s3..." } }
  const url = data.message?.recording_url
  if (!url) throw new Error('Voicemail audio upload succeeded but returned no recording_url')
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
  const fromE164 = toE164(from)
  const toE164Num = toE164(to)

  // Fail fast with a clear reason rather than letting VoiceDrop reject the
  // request as a vague "Invalid payload".
  if (!recordingUrl) {
    return { ok: false, status: 0, data: { status: 'error', message: 'Missing recording_url' } }
  }
  if (fromE164.replace(/\D/g, '').length < 11 || toE164Num.replace(/\D/g, '').length < 11) {
    return { ok: false, status: 0, data: { status: 'error', message: `Invalid phone number (from=${fromE164}, to=${toE164Num})` } }
  }

  const result = await vdPost('/ringless_voicemail', {
    recording_url: recordingUrl,
    from: fromE164,
    to: toE164Num,
    validate_recipient_phone: false,
    send_status_to_webhook: statusWebhookUrl || undefined,
  })

  console.log('[voicedrop:send]', {
    to: toE164Num,
    from: fromE164,
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
