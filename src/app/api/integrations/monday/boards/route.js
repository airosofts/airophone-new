// GET  /api/integrations/monday/boards         → boards usable in pickers (allowlist-filtered)
// GET  /api/integrations/monday/boards?all=true → every board + an `enabled` flag (settings UI)
// POST /api/integrations/monday/boards          → save the allowlist { boardIds: [...] }
//
// Monday OAuth grants account-wide board access; this allowlist is an app-level
// choice of which boards a workspace actually exposes. enabled_boards = NULL means
// "all boards" (default, backward-compatible).

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { supabaseAdmin } from '@/lib/supabase-server'
import { listBoards, MondayNotConnectedError, MondayApiError } from '@/lib/monday'

async function getAllowlist(workspaceId) {
  const { data } = await supabaseAdmin
    .from('workspace_integrations')
    .select('enabled_boards')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'monday')
    .maybeSingle()
  return Array.isArray(data?.enabled_boards) ? data.enabled_boards.map(String) : null   // null = all
}

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const wantAll = new URL(request.url).searchParams.get('all') === 'true'
  try {
    const boards = await listBoards(user.workspaceId)
    const allow = await getAllowlist(user.workspaceId)

    if (wantAll) {
      // Settings: every board, marked enabled (no allowlist → all enabled).
      return NextResponse.json({
        boards: boards.map(b => ({ ...b, enabled: allow === null || allow.includes(String(b.id)) })),
        hasAllowlist: allow !== null,
      })
    }

    // Pickers: only the boards this workspace chose to expose.
    const filtered = allow === null ? boards : boards.filter(b => allow.includes(String(b.id)))
    return NextResponse.json({ boards: filtered })
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

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.boardIds) ? body.boardIds.map(String) : null
  if (!ids) return NextResponse.json({ error: 'boardIds array required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('workspace_integrations')
    .update({ enabled_boards: ids })
    .eq('workspace_id', user.workspaceId)
    .eq('provider', 'monday')

  if (error) {
    console.error('[monday/boards] save allowlist error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
