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
  // Log the granted scopes once per call — invaluable when a mutation fails
  // with UNAUTHORIZED_FIELD_OR_TYPE (Monday's "your token lacks the scope"
  // error). If `webhooks:write` is missing here, the user needs to reconnect.
  const scope = data?.credentials?.scope
  if (scope) console.log('[monday] using token with scopes:', scope)
  return token
}

export async function mondayGraphQL(workspaceId, query, variables = {}) {
  const token = await getAccessToken(workspaceId)
  const res = await fetch(MONDAY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      // Bumped from 2024-01 → 2024-10 to match Monday's current stable. Older
      // versions sometimes return "Unauthorized field or type" for enums whose
      // shape changed (e.g. WebhookEventType).
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.errors) {
    // Log the FULL response so we can see what Monday actually complained about
    // — `body.errors[0].message` alone often hides the real cause (extensions,
    // path, etc.). The error class only surfaces the first message to the UI.
    console.error('[monday] GraphQL error', JSON.stringify({
      status: res.status,
      query: query.replace(/\s+/g, ' ').trim().slice(0, 200),
      variables,
      errors: body.errors,
      error_code: body.error_code,
      error_message: body.error_message,
      body,
    }, null, 2))
    throw new MondayApiError(
      body.errors?.[0]?.message || body.error_message || `Monday API error (${res.status})`,
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
        columns { id title type description settings_str }
      }
    }
  `, { boardId: [String(boardId)] })
  return data?.boards?.[0]?.columns || []
}

// Fetch every item in a board (or in the selected groups), fully paginated.
// When `groupIds` is given we page the SELECTED GROUPS directly (server-side
// filter via boards.groups.items_page) instead of scanning the whole board and
// filtering in JS — so large groups are never truncated. next_items_page
// continues whichever items_page produced the cursor (board- or group-scoped).
export async function listAllItems(workspaceId, boardId, { groupIds = null, maxItems = 100000 } = {}) {
  const items = []
  const ITEM_FIELDS = `id name group { id title } column_values { id type text value }`

  const pumpFromCursor = async (cursor) => {
    while (cursor && items.length < maxItems) {
      const data = await mondayGraphQL(workspaceId, `
        query ($cursor: String!) {
          next_items_page(limit: 500, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } }
        }
      `, { cursor })
      const page = data?.next_items_page
      for (const it of (page?.items || [])) { items.push(it); if (items.length >= maxItems) break }
      cursor = page?.cursor || null
    }
  }

  if (groupIds && groupIds.length > 0) {
    // Only the selected groups' items — each fully paged. No whole-board scan.
    for (const gid of groupIds) {
      const data = await mondayGraphQL(workspaceId, `
        query ($boardId: [ID!], $gid: [String!]) {
          boards(ids: $boardId) {
            groups(ids: $gid) {
              items_page(limit: 500) { cursor items { ${ITEM_FIELDS} } }
            }
          }
        }
      `, { boardId: [String(boardId)], gid: [String(gid)] })
      const page = data?.boards?.[0]?.groups?.[0]?.items_page
      for (const it of (page?.items || [])) { items.push(it); if (items.length >= maxItems) break }
      await pumpFromCursor(page?.cursor || null)
      if (items.length >= maxItems) break
    }
  } else {
    // No group filter → page through the whole board.
    const data = await mondayGraphQL(workspaceId, `
      query ($boardId: [ID!]) {
        boards(ids: $boardId) { items_page(limit: 500) { cursor items { ${ITEM_FIELDS} } } }
      }
    `, { boardId: [String(boardId)] })
    const page = data?.boards?.[0]?.items_page
    for (const it of (page?.items || [])) { items.push(it); if (items.length >= maxItems) break }
    await pumpFromCursor(page?.cursor || null)
  }

  return items
}

// Fetch a single item with its column values — used by the automation webhook
// when Monday only hands us an item id.
export async function getItem(workspaceId, itemId) {
  const data = await mondayGraphQL(workspaceId, `
    query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        name
        group { id title }
        column_values { id type text value }
      }
    }
  `, { ids: [String(itemId)] })
  return data?.items?.[0] || null
}

// ── Webhooks ─────────────────────────────────────────────────────────────────
// Register a webhook on a board. `event` is a Monday event enum, e.g.
// 'create_item', 'change_column_value', 'move_item_to_group'. Returns the
// webhook id, which must be stored so it can be deleted later.
export async function createWebhook(workspaceId, boardId, url, event) {
  const data = await mondayGraphQL(workspaceId, `
    mutation ($boardId: ID!, $url: String!, $event: WebhookEventType!) {
      create_webhook(board_id: $boardId, url: $url, event: $event) { id board_id }
    }
  `, { boardId: String(boardId), url, event })
  return data?.create_webhook?.id ? String(data.create_webhook.id) : null
}

export async function deleteWebhook(workspaceId, webhookId) {
  await mondayGraphQL(workspaceId, `
    mutation ($id: ID!) { delete_webhook(id: $id) { id } }
  `, { id: String(webhookId) })
}

// ── Two-way writeback ────────────────────────────────────────────────────────
// Update a single column on a Monday item. `value` must already be the JSON
// shape Monday expects for that column type:
//   status:  { "label": "Engaged" }
//   date:    { "date": "2026-05-25" }
//   text:    "free text string"
// We pass it as a JSON-encoded string per Monday's API contract — that's why
// the mutation's value type is `JSON!`, not the matching column-specific type.
export async function updateColumnValue(workspaceId, boardId, itemId, columnId, value) {
  const data = await mondayGraphQL(workspaceId, `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value,
        create_labels_if_missing: true
      ) { id }
    }
  `, {
    boardId: String(boardId),
    itemId: String(itemId),
    columnId,
    value: JSON.stringify(value),
  })
  return data?.change_column_value?.id || null
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
