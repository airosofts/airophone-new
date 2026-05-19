// GET /api/integrations/monday/boards
// Returns the connected Monday account's active boards.

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listBoards, MondayNotConnectedError, MondayApiError } from '@/lib/monday'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const boards = await listBoards(user.workspaceId)
    return NextResponse.json({ boards })
  } catch (err) {
    if (err instanceof MondayNotConnectedError) {
      return NextResponse.json({ error: 'not_connected' }, { status: 400 })
    }
    if (err instanceof MondayApiError) {
      console.error('[monday/boards] Monday API error:', err.errors)
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[monday/boards] unexpected:', err)
    return NextResponse.json({ error: 'Failed to list boards' }, { status: 500 })
  }
}
