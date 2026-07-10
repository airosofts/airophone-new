// Resolve an SMS campaign's recipients from a linked Monday board, a linked
// Google Sheet tab, or the selected contact lists. Returns a de-duplicated array:
//   [{ key: {contact_id|monday_item_id|sheet_row_id}, phone, vars, displayName }]
// Shared by the start route (initial enqueue) and the recurring re-enqueue.
import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { listAllItems, extractPhone, columnTitleToPlaceholder, listColumns } from '@/lib/monday'
import { getSheetData, buildRowVars } from '@/lib/google-sheets'
import { fetchAllContacts } from '@/lib/contacts-fetch'

export async function resolveCampaignRecipients(campaign, workspaceId) {
  const { data: mondayLink } = await supabaseAdmin
    .from('campaign_monday_links')
    .select('board_id, group_ids, item_ids, phone_column_id')
    .eq('campaign_id', campaign.id)
    .maybeSingle()

  const { data: sheetsLink } = mondayLink ? { data: null } : await supabaseAdmin
    .from('campaign_sheets_links')
    .select('spreadsheet_id, sheet_name, phone_column, row_ids')
    .eq('campaign_id', campaign.id)
    .maybeSingle()

  const recipients = []
  const seenPhones = new Set()

  if (mondayLink) {
    const columns = await listColumns(workspaceId, mondayLink.board_id)
    const items = await listAllItems(workspaceId, mondayLink.board_id, { groupIds: mondayLink.group_ids })
    const colSlugById = new Map(columns.map(c => [c.id, columnTitleToPlaceholder(c.title)]))
    const allowedItemIds =
      Array.isArray(mondayLink.item_ids) && mondayLink.item_ids.length > 0
        ? new Set(mondayLink.item_ids.map(String))
        : null

    for (const item of items) {
      if (allowedItemIds && !allowedItemIds.has(String(item.id))) continue
      const phoneCv = item.column_values.find(cv => cv.id === mondayLink.phone_column_id)
      const normalized = normalizePhoneNumber(extractPhone(phoneCv))
      if (!normalized || seenPhones.has(normalized)) continue
      seenPhones.add(normalized)

      const vars = { name: item.name || '', item_name: item.name || '' }
      for (const cv of item.column_values) {
        const slug = colSlugById.get(cv.id)
        if (slug) vars[slug] = cv.text || ''
      }
      recipients.push({ key: { monday_item_id: String(item.id) }, phone: normalized, vars, displayName: item.name || null })
    }
  } else if (sheetsLink) {
    const { headers, rows } = await getSheetData(workspaceId, sheetsLink.spreadsheet_id, sheetsLink.sheet_name)
    const allowedRowIds =
      Array.isArray(sheetsLink.row_ids) && sheetsLink.row_ids.length > 0
        ? new Set(sheetsLink.row_ids.map(String))
        : null

    for (const row of rows) {
      if (allowedRowIds && !allowedRowIds.has(String(row.rowNumber))) continue
      const normalized = normalizePhoneNumber(row.values[sheetsLink.phone_column] || '')
      if (!normalized || seenPhones.has(normalized)) continue
      seenPhones.add(normalized)

      const vars = buildRowVars(headers, row, sheetsLink.phone_column)
      recipients.push({
        key: { sheet_row_id: String(row.rowNumber) },
        phone: normalized,
        vars,
        displayName: vars.name || null,
      })
    }
  } else {
    const rawContacts = await fetchAllContacts({ workspaceId, contactListIds: campaign.contact_list_ids, columns: '*' })
    for (const c of (rawContacts || [])) {
      const normalized = normalizePhoneNumber(c.phone_number)
      if (!normalized || seenPhones.has(normalized)) continue
      seenPhones.add(normalized)
      recipients.push({
        key: { contact_id: c.id },
        phone: normalized,
        status: c.status || null,
        vars: {
          first_name: c.first_name || '', last_name: c.last_name || '', business_name: c.business_name || '',
          phone: c.phone_number || '', email: c.email || '', city: c.city || '', state: c.state || '', country: c.country || '',
        },
        displayName: c.business_name || null,
      })
    }
  }

  // Engagement filters ("only people who never replied", quiet period, …) —
  // evaluated against the SENDER LINE's conversation history, so they work
  // for every source (contacts, Monday, Sheets: all keyed by phone). Applied
  // here so the start route AND every recurring re-enqueue enforce them.
  const filters = campaign.recipient_filters
  if (hasActiveFilters(filters) && campaign.sender_number) {
    const engagement = await buildEngagementMap(campaign.sender_number, recipients.map(r => r.phone))
    return applyRecipientFilters(recipients, filters, engagement)
  }

  return recipients
}

export function hasActiveFilters(filters) {
  if (!filters) return false
  return (filters.engagement && filters.engagement !== 'all')
    || Number(filters.skip_contacted_hours) > 0
    || (Array.isArray(filters.exclude_statuses) && filters.exclude_statuses.length > 0)
}

// For each recipient phone, when did WE last text them and when did THEY last
// reply — on this sender line only. Uses per-conversation newest-message
// embeds (order+limit per parent), batched to keep URLs within limits.
// Returns Map(phone → { lastInboundAt, lastOutboundAt }) in epoch ms.
export async function buildEngagementMap(senderNumber, phones) {
  const map = new Map()
  const sender = normalizePhoneNumber(senderNumber)
  const unique = [...new Set(phones.filter(Boolean))]
  if (!sender || unique.length === 0) return map

  const BATCH = 150
  const record = (rows, field) => {
    for (const row of (rows || [])) {
      const t = row.messages?.[0]?.created_at
      if (!t) continue
      const e = map.get(row.phone_number) || {}
      e[field] = Math.max(e[field] || 0, new Date(t).getTime())
      map.set(row.phone_number, e)
    }
  }

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    const baseQuery = (direction) => supabaseAdmin
      .from('conversations')
      .select('phone_number, messages!inner(created_at)')
      .eq('from_number', sender)
      .in('phone_number', batch)
      .eq('messages.direction', direction)
      .order('created_at', { referencedTable: 'messages', ascending: false })
      .limit(1, { referencedTable: 'messages' })

    const [inbound, outbound] = await Promise.all([baseQuery('inbound'), baseQuery('outbound')])
    if (inbound.error) console.error('[engagement] inbound query error:', inbound.error)
    if (outbound.error) console.error('[engagement] outbound query error:', outbound.error)
    record(inbound.data, 'lastInboundAt')
    record(outbound.data, 'lastOutboundAt')
  }
  return map
}

export function applyRecipientFilters(recipients, filters, engagement) {
  if (!hasActiveFilters(filters)) return recipients
  const now = Date.now()
  const windowMs = Math.max(1, Number(filters.window_hours) || 24) * 3600 * 1000
  const quietMs = Math.max(0, Number(filters.skip_contacted_hours) || 0) * 3600 * 1000
  const excluded = new Set((filters.exclude_statuses || []).map(s => String(s).toLowerCase().trim()).filter(Boolean))

  return recipients.filter(r => {
    if (excluded.size && r.status && excluded.has(String(r.status).toLowerCase().trim())) return false

    const e = engagement.get(r.phone) || {}
    if (quietMs > 0 && e.lastOutboundAt && (now - e.lastOutboundAt) < quietMs) return false

    switch (filters.engagement) {
      case 'not_replied':        return !e.lastInboundAt                                        // never replied on this line
      case 'not_replied_recent': return !e.lastInboundAt || (now - e.lastInboundAt) >= windowMs // quiet for the window
      case 'replied':            return !!e.lastInboundAt                                       // re-engage responders
      case 'never_messaged':     return !e.lastOutboundAt                                       // fresh — never texted on this line
      default:                   return true
    }
  })
}

export function hydrateTemplate(template, vars) {
  if (!template) return ''
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}
