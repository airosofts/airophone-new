// Thin wrapper around VoiceDrop's REST API.
// Auth: `auth-key` header. Base: https://api.voicedrop.ai/v1
//
// Endpoints we use:
//   POST /sender-numbers/verify   — two-step phone verification
//   POST /ringless_voicemail       — send a Static Audio RVM

const VOICEDROP_BASE = process.env.VOICEDROP_API_URL || 'https://api.voicedrop.ai/v1'
const VOICEDROP_KEY  = process.env.VOICEDROP_API_KEY

function requireKey() {
  if (!VOICEDROP_KEY) throw new Error('VOICEDROP_API_KEY is not set')
}

// Normalize a phone number → "8382048923" (10 digits, no + or country code).
// VoiceDrop accepts US numbers without country code prefix in their examples.
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
// status_webhook will receive VoiceDrop's delivery updates.
export async function sendStaticVoicemail({ recordingUrl, from, to, statusWebhookUrl, validateRecipientPhone = true }) {
  const result = await vdPost('/ringless_voicemail', {
    recording_url: recordingUrl,
    from: toLocalDigits(from),
    to: toLocalDigits(to),
    validate_recipient_phone: validateRecipientPhone,
    send_status_to_webhook: statusWebhookUrl || undefined,
  })

  // Log full response so server logs show exactly what VoiceDrop returns
  console.log('[voicedrop:send]', {
    to: toLocalDigits(to),
    from: toLocalDigits(from),
    httpOk: result.ok,
    httpStatus: result.status,
    response: result.data,
  })

  // Detect body-level errors: if HTTP 200 but response contains an explicit error
  // field (no voice_drop_id AND an error/message field), treat it as a failure.
  if (result.ok && !result.data?.voice_drop_id) {
    const hasBodyError = result.data?.error || result.data?.message
    if (hasBodyError) {
      result.ok = false
      result.data = {
        ...result.data,
        message: result.data.message || result.data.error,
      }
    }
    // If no voice_drop_id but also no explicit error, log a warning but let it through
    // so we don't break delivery for APIs that return a different ID field.
    else {
      console.warn('[voicedrop:send] no voice_drop_id in response — delivery tracking will not work', result.data)
    }
  }

  return result
}
