// Telnyx Number Lookup — carrier / line-type detection for landline scrubbing.
// GET https://api.telnyx.com/v2/number_lookup/{e164}?type=carrier
//   → { data: { carrier: { name, type } } }  where type ≈ mobile|landline|voip
//
// We normalize to: 'mobile' | 'voip' | 'landline' | 'unknown'.

const BASE = 'https://api.telnyx.com/v2/number_lookup'

export function classifyLineType(carrierType) {
  const t = String(carrierType || '').toLowerCase()
  if (!t) return 'unknown'
  if (t.includes('mobile') || t.includes('wireless') || t.includes('cellular')) return 'mobile'
  if (t.includes('voip')) return 'voip'
  if (t.includes('landline') || t.includes('fixed') || t.includes('land line')) return 'landline'
  return 'unknown'
}

// Look up ONE number. Returns { lineType, carrier, ok }. Never throws.
export async function lookupLineType(e164) {
  const key = process.env.TELNYX_API_KEY
  if (!key) return { lineType: 'unknown', ok: false, error: 'TELNYX_API_KEY not set' }
  // Retry transient failures (429 rate-limit / 5xx / network) a couple times
  // so a temporary hiccup doesn't mis-classify a real landline as 'unknown'.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(e164)}?type=carrier`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        const carrier = json?.data?.carrier || {}
        return { lineType: classifyLineType(carrier.type), ok: true, carrier: carrier.name || null }
      }
      // 4xx other than 429 won't get better by retrying → stop.
      if (res.status !== 429 && res.status < 500) return { lineType: 'unknown', ok: false, status: res.status }
    } catch { /* network — retry */ }
    if (attempt < 3) await new Promise(r => setTimeout(r, 400 * attempt))
  }
  return { lineType: 'unknown', ok: false }
}

// Look up MANY numbers with bounded concurrency. Returns Map<phone, lineType>.
export async function lookupManyLineTypes(phones, { concurrency = 10 } = {}) {
  const results = new Map()
  let i = 0
  const worker = async () => {
    while (i < phones.length) {
      const idx = i++
      const phone = phones[idx]
      const r = await lookupLineType(phone)
      results.set(phone, r.lineType)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, phones.length) }, worker))
  return results
}
