// Helpers for RVM campaign "send to multiple phone columns".
//
// The contacts table only has one real `phone_number` column. Extra phone
// columns (Phone 2, Mobile, Work, …) live inside `contacts.custom_fields`
// as JSONB string values — populated by the CSV importer when a CSV header
// is mapped as `custom:<key>`.
//
// detectPhoneColumns scans a list of contact rows and finds the primary
// column plus any custom_fields keys whose values look like phones. The
// wizard uses this to let the user tick which phone columns to text.
//
// buildRecipients turns selected columns + contacts into a deduped list of
// recipient rows (one per phone), ready for the sender loop.

import { normalizePhoneNumber } from '@/lib/phone-utils'

// A string is "phone-like" if it has 7–15 digits after stripping. That's
// long enough to be a real phone number but short enough to exclude things
// like credit card numbers (16+) or ZIP codes (5).
function isPhoneLike(s) {
  if (s == null) return false
  const str = String(s).trim()
  if (!str) return false
  const digits = str.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

// Scan contacts and return every column we'd offer in the picker, including
// counts so the UI can show "Phone (primary) · 1,234 contacts".
//
// Returns: [
//   { key, label, count, isPrimary }
// ]
// `key` is the storage key — 'phone_number' for the primary, or the
//   custom_fields key (e.g. 'phone_2', 'mobile') for everything else.
// `label` is a friendly display string.
export function detectPhoneColumns(contacts) {
  const customCounts = new Map()
  let primaryCount = 0

  for (const c of contacts || []) {
    if (isPhoneLike(c?.phone_number)) primaryCount++
    const cf = c?.custom_fields
    if (cf && typeof cf === 'object') {
      for (const [k, v] of Object.entries(cf)) {
        if (isPhoneLike(v)) customCounts.set(k, (customCounts.get(k) || 0) + 1)
      }
    }
  }

  const out = [
    { key: 'phone_number', label: 'Phone (primary)', count: primaryCount, isPrimary: true },
  ]
  // Stable order: alphabetical key, so the picker doesn't jitter on refetch.
  const sortedKeys = [...customCounts.keys()].sort()
  for (const k of sortedKeys) {
    out.push({ key: k, label: prettifyKey(k), count: customCounts.get(k), isPrimary: false })
  }
  return out
}

function prettifyKey(k) {
  return String(k)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

// Read one column off a contact (handles primary vs custom_fields lookup).
export function readPhoneFromContact(contact, columnKey) {
  if (columnKey === 'phone_number') return contact?.phone_number || null
  return contact?.custom_fields?.[columnKey] || null
}

// Build the deduped recipient list for a campaign:
//   - Iterate contacts in the given order.
//   - For each contact, walk the selected columns in the order the user
//     chose them; emit a recipient row per non-empty E.164.
//   - Dedupe by E.164 globally — the same number won't get the voicemail
//     twice even if it appears in two columns or two contacts.
//
// Returns: [{ contactId, name, phone, sourceColumn }]
export function buildRecipients(contacts, selectedColumns) {
  const seen = new Set()
  const out = []
  if (!Array.isArray(contacts) || !Array.isArray(selectedColumns)) return out
  for (const c of contacts) {
    for (const col of selectedColumns) {
      const raw = readPhoneFromContact(c, col)
      const e164 = normalizePhoneNumber(raw)
      if (!e164 || seen.has(e164)) continue
      seen.add(e164)
      out.push({
        contactId: c.id,
        name: contactDisplayName(c),
        phone: e164,
        sourceColumn: col,
      })
    }
  }
  return out
}

function contactDisplayName(c) {
  if (!c) return ''
  const fn = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  return fn || c.business_name || ''
}

// Split recipients into fixed-size chunks for chunked sends.
// chunkSize <= 0 means "no chunking, one chunk with everyone".
// Returns: [{ n, start, end, count, recipients }]
export function chunkRecipients(recipients, chunkSize) {
  const list = Array.isArray(recipients) ? recipients : []
  if (!chunkSize || chunkSize <= 0 || chunkSize >= list.length) {
    return [{
      n: 1, start: 1, end: list.length, count: list.length, recipients: list,
    }]
  }
  const chunks = []
  for (let i = 0; i < list.length; i += chunkSize) {
    const slice = list.slice(i, i + chunkSize)
    chunks.push({
      n: chunks.length + 1,
      start: i + 1,
      end: i + slice.length,
      count: slice.length,
      recipients: slice,
    })
  }
  return chunks
}
