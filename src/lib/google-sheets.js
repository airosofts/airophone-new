// Thin wrapper around the Google Sheets + Drive REST APIs for the integration
// feature — the Google Sheets sibling of src/lib/monday.js.
//
// Tokens are stored in workspace_integrations.credentials by the OAuth
// callback: { access_token, refresh_token, expires_at, scope }. Google access
// tokens expire after ~1h, so every helper goes through getAccessToken(),
// which refreshes (and persists) the token when it's within a minute of
// expiry. If the refresh token is revoked the workspace must reconnect.

import { supabaseAdmin } from '@/lib/supabase-server'
import { appOrigin } from '@/lib/monday'

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// spreadsheets       — read + write sheet cells (campaigns, automations, writeback)
// drive.metadata.readonly — list the user's spreadsheets for the pickers
// userinfo.email     — label the connection in Settings
export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export class SheetsNotConnectedError extends Error {
  constructor(message = 'Google Sheets integration not connected for this workspace') {
    super(message)
    this.name = 'SheetsNotConnectedError'
  }
}

export class SheetsApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'SheetsApiError'
    this.status = status
  }
}

async function refreshAccessToken(workspaceId, credentials) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: credentials.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    // invalid_grant = the user revoked access in their Google account; the
    // stored connection is dead and the workspace must reconnect.
    console.error('[google-sheets] token refresh failed:', json.error || res.status)
    throw new SheetsNotConnectedError('Google access expired — reconnect Google Sheets in Settings → Integrations')
  }

  const updated = {
    ...credentials,
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in || 3600) * 1000,
  }
  await supabaseAdmin
    .from('workspace_integrations')
    .update({ credentials: updated, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_sheets')
  return updated.access_token
}

async function getAccessToken(workspaceId) {
  const { data, error } = await supabaseAdmin
    .from('workspace_integrations')
    .select('credentials')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_sheets')
    .maybeSingle()
  if (error) throw error
  const creds = data?.credentials
  if (!creds?.refresh_token && !creds?.access_token) throw new SheetsNotConnectedError()

  // Refresh with a 60s safety margin so a token can't expire mid-request.
  const expired = !creds.expires_at || Date.now() > Number(creds.expires_at) - 60_000
  if (expired && creds.refresh_token) return refreshAccessToken(workspaceId, creds)
  return creds.access_token
}

async function googleFetch(workspaceId, url, options = {}) {
  const token = await getAccessToken(workspaceId)
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('[google-sheets] API error', {
      status: res.status,
      url: url.slice(0, 200),
      error: body?.error,
    })
    if (res.status === 401) {
      throw new SheetsNotConnectedError('Google rejected the token — reconnect Google Sheets in Settings → Integrations')
    }
    throw new SheetsApiError(body?.error?.message || `Google API error (${res.status})`, res.status)
  }
  return body
}

// ── High-level helpers ──────────────────────────────────────────────────────

// The user's spreadsheets, most recently modified first. Capped at 200 —
// mirrors listBoards(); users with more can search by name in the picker.
export async function listSpreadsheets(workspaceId) {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: 'modifiedTime desc',
    pageSize: '200',
    fields: 'files(id,name,modifiedTime)',
    // Include spreadsheets shared with the user, not just owned ones.
    corpora: 'user',
  })
  const data = await googleFetch(workspaceId, `${DRIVE_FILES_URL}?${params}`)
  return (data.files || []).map(f => ({ id: f.id, name: f.name, modified_at: f.modifiedTime }))
}

// Tabs on a spreadsheet — the Sheets equivalent of Monday groups.
export async function listTabs(workspaceId, spreadsheetId) {
  const data = await googleFetch(
    workspaceId,
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`
  )
  return {
    title: data.properties?.title || null,
    tabs: (data.sheets || []).map(s => ({
      id: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount || 0,
    })),
  }
}

// 0 → 'A', 25 → 'Z', 26 → 'AA' …
export function columnLetter(index) {
  let n = index, out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

// Same slug rule as Monday columns: "First Name" → first_name.
export function headerToPlaceholder(title) {
  if (!title) return ''
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// A crude but effective phone-column guess for auto-selection in the UI.
export function looksLikePhoneHeader(title) {
  return /phone|mobile|cell|contact.?number|tel/i.test(String(title || ''))
}

// Read a whole tab. Row 1 is the header row; rows 2+ are data.
// Returns:
//   headers: [{ id: 'A', title: 'First Name', placeholder: 'first_name' }]
//   rows:    [{ rowNumber: 2, values: { A: 'John', B: '+1555…' } }]
export async function getSheetData(workspaceId, spreadsheetId, sheetName, { maxRows = 100000 } = {}) {
  const range = `'${String(sheetName).replace(/'/g, "''")}'`
  const data = await googleFetch(
    workspaceId,
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`
  )
  const grid = data.values || []
  const headerRow = grid[0] || []

  const headers = headerRow.map((title, i) => ({
    id: columnLetter(i),
    title: String(title ?? '').trim() || columnLetter(i),
    placeholder: headerToPlaceholder(String(title ?? '').trim()) || columnLetter(i).toLowerCase(),
  }))

  const rows = []
  for (let i = 1; i < grid.length && rows.length < maxRows; i++) {
    const raw = grid[i] || []
    // Skip fully empty rows — trailing blanks are common in sheets.
    if (!raw.some(v => String(v ?? '').trim() !== '')) continue
    const values = {}
    for (let c = 0; c < headers.length; c++) {
      values[headers[c].id] = String(raw[c] ?? '').trim()
    }
    rows.push({ rowNumber: i + 1, values })
  }

  return { headers, rows }
}

// Placeholder vars for one row: {{first_name}} etc, plus {{name}} defaulting
// to the first non-phone column so templates written for Monday "just work".
export function buildRowVars(headers, row, phoneColumn = null) {
  const vars = {}
  for (const h of headers) vars[h.placeholder] = row.values[h.id] || ''
  if (!vars.name) {
    const firstText = headers.find(h => h.id !== phoneColumn && (row.values[h.id] || '').trim())
    vars.name = firstText ? row.values[firstText.id] : ''
  }
  if (!vars.item_name) vars.item_name = vars.name
  return vars
}

// ── Two-way writeback ────────────────────────────────────────────────────────

// Write one cell, e.g. updateCell(ws, id, 'Sheet1', 'D', 12, 'Replied').
export async function updateCell(workspaceId, spreadsheetId, sheetName, column, rowNumber, value) {
  const range = `'${String(sheetName).replace(/'/g, "''")}'!${column}${rowNumber}`
  await googleFetch(
    workspaceId,
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: [[String(value)]] }) }
  )
}

// Locate a lead's row by the phone in the given column. Row numbers shift as
// rows are inserted/deleted, so writebacks re-resolve by phone at write time.
// `normalize` is passed in (phone-utils) to keep this lib dependency-light.
export async function findRowByPhone(workspaceId, spreadsheetId, sheetName, phoneColumn, phone, normalize) {
  const { rows } = await getSheetData(workspaceId, spreadsheetId, sheetName)
  const target = normalize ? normalize(phone) : phone
  for (const row of rows) {
    const cell = row.values[phoneColumn] || ''
    const candidate = normalize ? normalize(cell) : cell
    if (candidate && candidate === target) return row
  }
  return null
}

// The OAuth redirect_uri — must exactly match a URL registered on the Google
// Cloud OAuth client (same rule as Monday's).
export function sheetsRedirectUri(request) {
  return `${appOrigin(request)}/api/integrations/google-sheets/oauth/callback`
}
