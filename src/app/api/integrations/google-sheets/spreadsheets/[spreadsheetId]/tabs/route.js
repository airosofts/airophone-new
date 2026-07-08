// GET /api/integrations/google-sheets/spreadsheets/[spreadsheetId]/tabs
// → the tabs on a spreadsheet — the Sheets equivalent of Monday groups.

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listTabs, SheetsNotConnectedError } from '@/lib/google-sheets'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { spreadsheetId } = await params

  try {
    const { title, tabs } = await listTabs(user.workspaceId, spreadsheetId)
    return NextResponse.json({ title, tabs })
  } catch (err) {
    if (err instanceof SheetsNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[sheets/tabs GET] error:', err)
    return NextResponse.json({ error: 'Failed to load spreadsheet tabs' }, { status: 502 })
  }
}
