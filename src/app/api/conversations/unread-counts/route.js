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
    const { data: unreadRows, error: unreadError } = await supabaseAdmin
      .from('messages')
      .select('conversation_id, conversations!inner(from_number, phone_number)')
      .eq('direction', 'inbound')
      .is('read_at', null)

    if (unreadError) {
      console.error('unread-counts query error:', unreadError)
      return NextResponse.json({ counts: {} })
    }

    if (!unreadRows?.length) return NextResponse.json({ counts: {} })

    // Group by workspace phone, counting distinct conversations
    const seenByPhone = {}
    for (const row of unreadRows) {
      const conv = row.conversations
      if (!conv?.from_number) continue
      if (!wsPhonesSet.has(conv.from_number)) continue
      if (blockedNumbers.has(conv.phone_number)) continue

      if (!seenByPhone[conv.from_number]) seenByPhone[conv.from_number] = new Set()
      seenByPhone[conv.from_number].add(row.conversation_id)
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
