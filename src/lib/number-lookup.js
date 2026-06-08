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
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(e164)}?type=carrier`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return { lineType: 'unknown', ok: false, status: res.status }
    const json = await res.json().catch(() => ({}))
    const carrier = json?.data?.carrier || {}
    return { lineType: classifyLineType(carrier.type), ok: true, carrier: carrier.name || null }
  } catch (err) {
    return { lineType: 'unknown', ok: false, error: err.message }
  }
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
