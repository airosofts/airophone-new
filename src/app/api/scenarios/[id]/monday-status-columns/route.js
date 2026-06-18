// Status columns (+ their labels) for the Monday board(s) this scenario's leads
// come from — used by the follow-up sequence editor to offer real status picks
// per stage (no free-text). We resolve the board via the scenario's phone lines:
//   scenario → scenario_phone_numbers → monday_automations(sender line) → board
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { listColumns } from '@/lib/monday'

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!user || !workspace?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: scenario } = await supabaseAdmin
    .from('scenarios').select('id').eq('id', id).eq('workspace_id', workspace.workspaceId).maybeSingle()
  if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

  // Lines this scenario runs on.
  const { data: links } = await supabaseAdmin
    .from('scenario_phone_numbers').select('phone_number_id').eq('scenario_id', id)
  const lineIds = [...new Set((links || []).map(l => l.phone_number_id).filter(Boolean))]

  // Boards of automations that SEND from those lines.
  let boards = []
  if (lineIds.length) {
    const { data: autos } = await supabaseAdmin
      .from('monday_automations')
      .select('board_id, board_name')
      .eq('workspace_id', workspace.workspaceId)
      .in('sender_phone_number_id', lineIds)
    const seen = new Set()
    for (const a of (autos || [])) {
      if (a.board_id && !seen.has(String(a.board_id))) {
        seen.add(String(a.board_id))
        boards.push({ id: String(a.board_id), name: a.board_name || String(a.board_id) })
      }
    }
  }

  // Fetch each board's status columns + labels.
  const result = []
  for (const b of boards) {
    let cols = []
    try { cols = await listColumns(workspace.workspaceId, b.id) } catch { continue }
    const statusCols = (cols || [])
      .filter(c => c.type === 'status')
      .map(c => {
        let labels = []
        try { labels = Object.values(JSON.parse(c.settings_str || '{}').labels || {}).filter(Boolean) } catch {}
        return { id: c.id, title: c.title, labels }
      })
      .filter(c => c.labels.length > 0)
    if (statusCols.length) result.push({ board_id: b.id, board_name: b.name, columns: statusCols })
  }

  return NextResponse.json({ success: true, boards: result })
}
