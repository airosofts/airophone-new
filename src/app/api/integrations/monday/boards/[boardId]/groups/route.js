// GET /api/integrations/monday/boards/[boardId]/groups
// Returns the groups defined on a single Monday board.

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listGroups, MondayNotConnectedError, MondayApiError } from '@/lib/monday'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { boardId } = await params
  try {
    const groups = await listGroups(user.workspaceId, boardId)
    return NextResponse.json({ groups })
  } catch (err) {
    if (err instanceof MondayNotConnectedError) {
      return NextResponse.json({ error: 'not_connected' }, { status: 400 })
    }
    if (err instanceof MondayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[monday/groups] unexpected:', err)
    return NextResponse.json({ error: 'Failed to list groups' }, { status: 500 })
  }
}
