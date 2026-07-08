// GET /api/integrations/google-sheets/spreadsheets/[spreadsheetId]/columns?sheet=<tab title>
// → the header-row columns of a tab, shaped like the Monday columns endpoint:
//   { columns: [{ id: 'A', title, placeholder, isPhoneType }] }

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { getSheetData, looksLikePhoneHeader, SheetsNotConnectedError } from '@/lib/google-sheets'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { spreadsheetId } = await params
  const sheetName = new URL(request.url).searchParams.get('sheet')
  if (!sheetName) {
    return NextResponse.json({ error: 'sheet query param is required' }, { status: 400 })
  }

  try {
    const { headers } = await getSheetData(user.workspaceId, spreadsheetId, sheetName, { maxRows: 1 })
    return NextResponse.json({
      columns: headers.map(h => ({ ...h, isPhoneType: looksLikePhoneHeader(h.title) })),
    })
  } catch (err) {
    if (err instanceof SheetsNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[sheets/columns GET] error:', err)
    return NextResponse.json({ error: 'Failed to load sheet columns' }, { status: 502 })
  }
}
