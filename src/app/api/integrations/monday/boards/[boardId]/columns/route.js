// GET /api/integrations/monday/boards/[boardId]/columns
// Returns the columns on a single Monday board, with a derived `placeholder`
// field — the slug that will substitute in message templates (e.g. {{first_name}}).

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listColumns, columnTitleToPlaceholder, MondayNotConnectedError, MondayApiError } from '@/lib/monday'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { boardId } = await params
  try {
    const columns = await listColumns(user.workspaceId, boardId)
    const annotated = columns.map(c => ({
      ...c,
      placeholder: columnTitleToPlaceholder(c.title),
      // Hint the UI which columns are good candidates for the phone picker.
      isPhoneType: c.type === 'phone',
    }))
    return NextResponse.json({ columns: annotated })
  } catch (err) {
    if (err instanceof MondayNotConnectedError) {
      return NextResponse.json({ error: 'not_connected' }, { status: 400 })
    }
    if (err instanceof MondayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[monday/columns] unexpected:', err)
    return NextResponse.json({ error: 'Failed to list columns' }, { status: 500 })
  }
}
