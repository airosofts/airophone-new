// GET /api/integrations/google-sheets/spreadsheets/[spreadsheetId]/rows?sheet=<tab>&phone_column=<A>
// → data rows for the campaign recipient picker, shaped like the Monday items
//   endpoint: { rows: [{ id: '<rowNumber>', name, phone, columns: { A: '…' } }] }

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getSheetData, SheetsNotConnectedError } from '@/lib/google-sheets'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { spreadsheetId } = await params
  const url = new URL(request.url)
  const sheetName = url.searchParams.get('sheet')
  const phoneColumn = url.searchParams.get('phone_column')
  if (!sheetName) {
    return NextResponse.json({ error: 'sheet query param is required' }, { status: 400 })
  }

  try {
    const { headers, rows } = await getSheetData(user.workspaceId, spreadsheetId, sheetName)
    const nameCol = headers.find(h => h.id !== phoneColumn)?.id || headers[0]?.id
    return NextResponse.json({
      rows: rows.map(r => ({
        id: String(r.rowNumber),
        name: (nameCol && r.values[nameCol]) || `Row ${r.rowNumber}`,
        phone: phoneColumn ? (normalizePhoneNumber(r.values[phoneColumn] || '') || null) : null,
        columns: r.values,
      })),
    })
  } catch (err) {
    if (err instanceof SheetsNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[sheets/rows GET] error:', err)
    return NextResponse.json({ error: 'Failed to load sheet rows' }, { status: 502 })
  }
}
