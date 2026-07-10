import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

    // Get all workspace phone numbers
    const { data: phoneRows } = await supabaseAdmin
      .from('phone_numbers')
      .select('phone_number')
      .eq('workspace_id', workspace.workspaceId)

    const wsPhones = (phoneRows || []).map(p => p.phone_number)
    if (!wsPhones.length) return NextResponse.json({ counts: {} })
    const wsPhonesSet = new Set(wsPhones)

    // Fetch blocked phone numbers for this workspace (same logic as /api/conversations)
    const { data: blockedRows } = await supabaseAdmin
      .from('blocked_contacts')
      .select('phone_number')
      .eq('workspace_id', workspace.workspaceId)

    const blockedNumbers = new Set((blockedRows || []).map(r => r.phone_number))

    // Query unread inbound messages with their conversation joined.
    // Starting from messages (filtered by read_at IS NULL) is much smaller
    // than fetching every conversation, and avoids the PostgREST 1000-row
    // limit that was truncating the conversations lookup and dropping
    // unread badges for phones whose conversations fell outside the window.
    // Filter to THIS workspace's lines server-side and page adaptively — a
    // single unfiltered query gets clamped to the "Max rows" setting
    // (db-max-rows), which silently undercounts once unread messages pile
    // up. count: 'exact' returns the true total alongside the rows, so this
    // is one round trip when the server allows it and correct paging when it
    // doesn't.
    const WINDOW = 50000
    const seenByPhone = {}
    for (let offset = 0, total = null, fetched = 0; ; ) {
      const { data: unreadRows, count, error: unreadError } = await supabaseAdmin
        .from('messages')
        .select('id, conversation_id, conversations!inner(from_number, phone_number, status)', { count: 'exact' })
        .eq('direction', 'inbound')
        .is('read_at', null)
        .in('conversations.from_number', wsPhones)
        // Closed ("done") conversations shouldn't keep the badge lit — this
        // matches the inbox's default Open view, so the sidebar badge and the
        // in-page Unread chip always agree. NULL status counts as open (same
        // rule the inbox filter uses: status !== 'closed').
        .or('status.neq.closed,status.is.null', { referencedTable: 'conversations' })
        .order('id', { ascending: true })
        .range(offset, offset + WINDOW - 1)

      if (unreadError) {
        console.error('unread-counts query error:', unreadError)
        return NextResponse.json({ counts: {} })
      }

      // Group by workspace phone, counting distinct conversations
      for (const row of (unreadRows || [])) {
        const conv = row.conversations
        if (!conv?.from_number) continue
        if (!wsPhonesSet.has(conv.from_number)) continue
        if (blockedNumbers.has(conv.phone_number)) continue

        if (!seenByPhone[conv.from_number]) seenByPhone[conv.from_number] = new Set()
        seenByPhone[conv.from_number].add(row.conversation_id)
      }

      fetched += unreadRows?.length || 0
      if (total === null) total = count ?? 0
      if (!unreadRows || unreadRows.length === 0 || fetched >= total) break
      offset += unreadRows.length
    }

    const counts = {}
    for (const [phone, set] of Object.entries(seenByPhone)) {
      counts[phone] = set.size
    }

    return NextResponse.json({ counts })
  } catch (err) {
    console.error('unread-counts error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
