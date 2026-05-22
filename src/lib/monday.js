// Thin wrapper around Monday's GraphQL v2 API for the integration feature.
//
// Tokens are stored in workspace_integrations.credentials.access_token by
// the OAuth callback. Every helper takes a workspaceId and reads the token
// fresh — no caching here. If the row is missing the callers should treat
// "not connected" as a user-facing error (return 400, prompt to reconnect).

import { supabaseAdmin } from '@/lib/supabase-server'

const MONDAY_GRAPHQL_URL = 'https://api.monday.com/v2'

export class MondayNotConnectedError extends Error {
  constructor(message = 'Monday integration not connected for this workspace') {
    super(message)
    this.name = 'MondayNotConnectedError'
  }
}

export class MondayApiError extends Error {
  constructor(message, status, errors) {
    super(message)
    this.name = 'MondayApiError'
    this.status = status
    this.errors = errors
  }
}

async function getAccessToken(workspaceId) {
  const { data, error } = await supabaseAdmin
    .from('workspace_integrations')
    .select('credentials')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'monday')
    .maybeSingle()
  if (error) throw error
  const token = data?.credentials?.access_token
  if (!token) throw new MondayNotConnectedError()
  return token
}

export async function mondayGraphQL(workspaceId, query, variables = {}) {
  const token = await getAccessToken(workspaceId)
  const res = await fetch(MONDAY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      // 2024-01 enables items_page, the cursor-based pagination we rely on.
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.errors) {
    throw new MondayApiError(
      body.errors?.[0]?.message || `Monday API error (${res.status})`,
      res.status,
      body.errors,
    )
  }
  return body.data
}

// ── High-level helpers ──────────────────────────────────────────────────────

export async function listBoards(workspaceId) {
  // Cap at 200; users with more can search by name in the UI later.
  const data = await mondayGraphQL(workspaceId, `
    query { boards(limit: 200, state: active, order_by: used_at) {
      id name description state board_kind items_count
    } }
  `)
  return data?.boards || []
}

export async function listGroups(workspaceId, boardId) {
  const data = await mondayGraphQL(workspaceId, `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        groups { id title color }
      }
    }
  `, { boardId: [String(boardId)] })
  return data?.boards?.[0]?.groups || []
}

export async function listColumns(workspaceId, boardId) {
  const data = await mondayGraphQL(workspaceId, `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        columns { id title type description }
      }
    }
  `, { boardId: [String(boardId)] })
  return data?.boards?.[0]?.columns || []
}

// Page through items_page cursor until all items in a board are fetched.
// `groupIds` is optional — if provided, items are filtered client-side after
// fetching (Monday's items_page query_params group filter requires Items API
// v2, which isn't enabled on every account; client filter is universally safe).
export async function listAllItems(workspaceId, boardId, { groupIds = null, maxItems = 5000 } = {}) {
  const items = []
  let cursor = null
  // Stop after maxItems to protect against runaway boards.
  while (items.length < maxItems) {
    const data = await mondayGraphQL(workspaceId, `
      query ($boardId: [ID!], $cursor: String) {
        boards(ids: $boardId) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              group { id title }
              column_values { id type text value }
            }
          }
        }
      }
    `, { boardId: [String(boardId)], cursor })

    const page = data?.boards?.[0]?.items_page
    const batch = page?.items || []
    for (const it of batch) {
      if (groupIds && groupIds.length > 0 && !groupIds.includes(it.group?.id)) continue
      items.push(it)
      if (items.length >= maxItems) break
    }
    cursor = page?.cursor || null
    if (!cursor) break
  }
  return items
}

// ── Value extraction ────────────────────────────────────────────────────────

// Monday's `phone` column stores `{"phone":"+15551234","countryShortName":"US"}`
// in the `value` JSON; we also fall back to the `text` field for older boards
// where the column type is `text` or `phone-legacy`.
export function extractPhone(columnValue) {
  if (!columnValue) return null
  if (columnValue.value) {
    try {
      const parsed = JSON.parse(columnValue.value)
      if (parsed?.phone) return String(parsed.phone)
    } catch {}
  }
  return columnValue.text || null
}

// Normalize a Monday column title into a placeholder slug:
//   "Deal Amount"      → "deal_amount"
//   "Email (work)"     → "email_work"
//   "First Name"       → "first_name"
export function columnTitleToPlaceholder(title) {
  if (!title) return ''
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// The public origin the user actually hit (e.g. https://app.airophone.com or
// http://localhost:3000). `new URL(request.url)` is unreliable behind Vercel's
// proxy — it can report `http:` or an internal host. The `host` header is what
// the browser sent; protocol is https everywhere except local dev.
export function appOrigin(request) {
  const host = request.headers.get('host') || new URL(request.url).host
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
  const proto = isLocal ? 'http' : (request.headers.get('x-forwarded-proto') || 'https')
  return `${proto}://${host}`
}

// The OAuth redirect_uri must be byte-identical between the /start request
// (sent to Monday's authorize page) and the /callback request (sent in the
// token exchange) — and must exactly match a URL registered on the Monday app.
export function mondayRedirectUri(request) {
  return `${appOrigin(request)}/api/integrations/monday/oauth/callback`
}
