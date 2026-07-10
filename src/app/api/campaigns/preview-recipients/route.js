// POST /api/campaigns/preview-recipients — dry-run of the campaign audience.
// Body: { contact_list_ids: [...], sender_number: '+1…', filters: {...} }
// Returns exactly who would receive the send after engagement filters, with
// per-recipient last-texted / last-replied timestamps for the review page.
// Read-only; nothing is enqueued.

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { fetchAllContacts } from '@/lib/contacts-fetch'
import { buildEngagementMap, applyRecipientFilters, hasActiveFilters } from '@/lib/campaign-recipients'

const MAX_RETURNED = 1000   // counts are always exact; the row list is capped

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { contact_list_ids, sender_number, filters } = body
  if (!Array.isArray(contact_list_ids) || contact_list_ids.length === 0) {
    return NextResponse.json({ error: 'contact_list_ids is required' }, { status: 400 })
  }
  if (!sender_number) {
    return NextResponse.json({ error: 'sender_number is required' }, { status: 400 })
  }

  try {
    const rawContacts = await fetchAllContacts({
      workspaceId: user.workspaceId,
      contactListIds: contact_list_ids,
      columns: 'id, first_name, last_name, business_name, phone_number, status',
    })

    // Same dedupe-by-phone the real send does.
    const seen = new Set()
    const recipients = []
    for (const c of (rawContacts || [])) {
      const phone = normalizePhoneNumber(c.phone_number)
      if (!phone || seen.has(phone)) continue
      seen.add(phone)
      recipients.push({
        key: { contact_id: c.id },
        phone,
        status: c.status || null,
        displayName: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name || null,
      })
    }

    const engagement = await buildEngagementMap(sender_number, recipients.map(r => r.phone))
    const filtered = hasActiveFilters(filters)
      ? applyRecipientFilters(recipients, filters, engagement)
      : recipients

    return NextResponse.json({
      success: true,
      total: recipients.length,          // dedupled list size before filters
      matched: filtered.length,          // who will actually receive it
      excluded: recipients.length - filtered.length,
      truncated: filtered.length > MAX_RETURNED,
      recipients: filtered.slice(0, MAX_RETURNED).map(r => {
        const e = engagement.get(r.phone) || {}
        return {
          phone: r.phone,
          name: r.displayName,
          status: r.status,
          last_outbound_at: e.lastOutboundAt ? new Date(e.lastOutboundAt).toISOString() : null,
          last_inbound_at: e.lastInboundAt ? new Date(e.lastInboundAt).toISOString() : null,
        }
      }),
    })
  } catch (err) {
    console.error('[preview-recipients] error:', err)
    return NextResponse.json({ error: 'Failed to preview recipients' }, { status: 500 })
  }
}
