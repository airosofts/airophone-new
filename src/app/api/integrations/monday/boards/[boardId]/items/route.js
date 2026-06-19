// GET /api/integrations/monday/boards/[boardId]/items?groups=id1,id2
// Returns the items (rows) of a board so the campaign UI can show a row-level
// recipient picker. `groups` is optional — when present, only items in those
// groups are returned (mirrors the campaign's group filter).
//
// Each item is trimmed to what the picker needs: id, name, group, and the
// phone column's text (so the UI can show "Name — +1…" without re-fetching).

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listItemsPaged, extractPhone, MondayNotConnectedError, MondayApiError } from '@/lib/monday'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { boardId } = await params
  const url = new URL(request.url)
  const groupsParam = url.searchParams.get('groups')
  const phoneColumnId = url.searchParams.get('phone_column_id')
  const cursor = url.searchParams.get('cursor') || null   // opaque; null to start
  const groupIds = groupsParam
    ? groupsParam.split(',').map(s => s.trim()).filter(Boolean)
    : null

  try {
    // ONE page per call — the client loops on `cursor` to show live progress.
    const { items: raw, cursor: nextCursor } = await listItemsPaged(user.workspaceId, boardId, { groupIds, cursor })

    const items = raw.map(it => {
      const cvs = it.column_values || []
      const phoneCv = phoneColumnId ? cvs.find(cv => cv.id === phoneColumnId) : null
      return {
        id: String(it.id),
        name: it.name || '(untitled)',
        group: it.group ? { id: it.group.id, title: it.group.title } : null,
        phone: phoneCv ? extractPhone(phoneCv) : null,
        // columnId → display text, so the UI can filter rows by any column
        // (e.g. a status column) without another round-trip.
        columns: Object.fromEntries(cvs.map(cv => [cv.id, cv.text || ''])),
      }
    })

    return NextResponse.json({ items, cursor: nextCursor })
  } catch (err) {
    if (err instanceof MondayNotConnectedError) {
      return NextResponse.json({ error: 'not_connected' }, { status: 400 })
    }
    if (err instanceof MondayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[monday/items] unexpected:', err)
    return NextResponse.json({ error: 'Failed to list items' }, { status: 500 })
  }
}
