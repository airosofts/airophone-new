// Preview endpoint for the RVM campaign wizard.
//
// Given { contactListIds, phoneColumns?, chunkSize? } returns:
//   detectedColumns: phone-like columns found in those lists + counts
//   recipients:      first ~30 recipient rows for preview
//   totalRecipients: full count
//   chunks:          [{ n, start, end, count }] with the requested chunk size
//   alreadySentChunks: chunk indices previously launched against the same
//                     (sorted list_ids, chunk_size) — so the UI can warn
//                     when the user is about to re-send.
//
// Two passes:
//   Step 2 of the wizard calls this WITHOUT phoneColumns to discover what's
//   available; step 3 calls it WITH the user's picked columns + chunkSize.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import {
  detectPhoneColumns, buildRecipients, chunkRecipients,
} from '@/lib/phone-columns'

const MAX_RECIPIENTS  = 100_000   // safety cap on contacts pulled from DB
// When a chunk is selected, return the full chunk's recipient list so the
// wizard's UI can paginate, search, and per-row toggle. Hard ceiling so a
// stray "chunkSize = 1,000,000" doesn't return megabytes.
const MAX_FULL_RETURN = 50_000

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try { body = await request.json() } catch { body = {} }
  const contactListIds = Array.isArray(body.contactListIds) ? body.contactListIds : []
  const phoneColumns = Array.isArray(body.phoneColumns) ? body.phoneColumns : null
  const chunkSize = Number.isFinite(Number(body.chunkSize)) ? Math.max(0, Math.floor(Number(body.chunkSize))) : 0
  // Statuses to skip (e.g. do_not_call). Contacts carrying one are dropped
  // before counting/columns so the audience count reflects the exclusion live.
  const excludeStatuses = Array.isArray(body.excludeStatuses) ? body.excludeStatuses.filter(Boolean) : []

  if (contactListIds.length === 0) {
    return NextResponse.json({
      success: true, detectedColumns: [], totalRecipients: 0,
      recipients: [], chunks: [], alreadySentChunks: [],
    })
  }

  // Pull every contact in the selected lists. We need custom_fields for the
  // column scan, plus identifying fields for the preview table.
  const { data: contacts, error } = await supabaseAdmin
    .from('contacts')
    .select('id, first_name, last_name, business_name, phone_number, custom_fields, status')
    .eq('workspace_id', workspace.workspaceId)
    .in('contact_list_id', contactListIds)
    .order('created_at', { ascending: true })
    .limit(MAX_RECIPIENTS)

  if (error) {
    console.error('[voicemail/preview] contacts query error:', error)
    return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 })
  }

  // Drop excluded-status contacts (do_not_call, etc.) up front.
  const allContacts = contacts || []
  const excludedCount = excludeStatuses.length > 0
    ? allContacts.filter(c => c.status && excludeStatuses.includes(c.status)).length
    : 0
  const filteredContacts = excludeStatuses.length > 0
    ? allContacts.filter(c => !c.status || !excludeStatuses.includes(c.status))
    : allContacts

  const detectedColumns = detectPhoneColumns(filteredContacts)

  // Default the selection to the primary column if the caller didn't specify.
  const selectedColumns = phoneColumns && phoneColumns.length > 0
    ? phoneColumns
    : ['phone_number']

  const recipients = buildRecipients(filteredContacts, selectedColumns)
  const chunks = chunkRecipients(recipients, chunkSize)

  // chunkIndex (1-based). Caller picks which chunk to "zoom into"; we return
  // that chunk's recipients in full so the UI can paginate/search/select
  // within it. If no chunk picked (or chunkSize=0), return the whole list
  // (still capped at MAX_FULL_RETURN).
  const requestedChunkIdx = Number.isFinite(Number(body.chunkIndex))
    ? Math.max(0, Math.floor(Number(body.chunkIndex)))
    : 0
  let chunkRecipients_ = recipients
  if (requestedChunkIdx > 0 && chunks[requestedChunkIdx - 1]) {
    chunkRecipients_ = chunks[requestedChunkIdx - 1].recipients
  }
  const truncated = chunkRecipients_.length > MAX_FULL_RETURN
  const returned = truncated ? chunkRecipients_.slice(0, MAX_FULL_RETURN) : chunkRecipients_

  // Already-sent chunk lookup. Match on (workspace, sorted list_ids, chunk_size).
  // Postgres jsonb @> works on subset; we store contact_list_ids as jsonb array.
  // Sort the IDs so two requests with the same set match regardless of order.
  const sortedIds = [...contactListIds].map(String).sort()
  let alreadySentChunks = []
  if (chunkSize > 0) {
    const { data: priors } = await supabaseAdmin
      .from('voicemail_campaigns')
      .select('chunk_index, contact_list_ids, created_at, status')
      .eq('workspace_id', workspace.workspaceId)
      .eq('chunk_size', chunkSize)
      .in('status', ['draft', 'running', 'completed', 'failed'])
    for (const p of (priors || [])) {
      const pIds = Array.isArray(p.contact_list_ids) ? [...p.contact_list_ids].map(String).sort() : []
      if (pIds.length === sortedIds.length && pIds.every((v, i) => v === sortedIds[i])) {
        if (Number.isFinite(p.chunk_index) && p.chunk_index > 0) {
          alreadySentChunks.push({ n: p.chunk_index, status: p.status, at: p.created_at })
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    detectedColumns,
    totalRecipients: recipients.length,
    excludedByStatus: excludedCount,
    // Full recipient list (capped) for the selected chunk — used by the
    // wizard table to paginate, search, and per-row select/unselect.
    recipients: returned,
    truncated,
    chunks: chunks.map(({ recipients: _r, ...meta }) => meta),
    alreadySentChunks,
  })
}
