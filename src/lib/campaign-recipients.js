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
        vars: {
          first_name: c.first_name || '', last_name: c.last_name || '', business_name: c.business_name || '',
          phone: c.phone_number || '', email: c.email || '', city: c.city || '', state: c.state || '', country: c.country || '',
        },
        displayName: c.business_name || null,
      })
    }
  }

  return recipients
}

export function hydrateTemplate(template, vars) {
  if (!template) return ''
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}
