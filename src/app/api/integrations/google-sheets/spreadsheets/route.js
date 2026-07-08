// GET /api/integrations/google-sheets/spreadsheets
// → the user's spreadsheets (most recently modified first), for the pickers.

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listSpreadsheets, SheetsNotConnectedError } from '@/lib/google-sheets'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const spreadsheets = await listSpreadsheets(user.workspaceId)
    return NextResponse.json({ spreadsheets })
  } catch (err) {
    if (err instanceof SheetsNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[sheets/spreadsheets GET] error:', err)
    return NextResponse.json({ error: 'Failed to list spreadsheets' }, { status: 502 })
  }
}
