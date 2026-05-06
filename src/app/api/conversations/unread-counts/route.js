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

    // Get all conversations for these phone numbers
    const { data: convs } = await supabaseAdmin
      .from('conversations')
      .select('id, from_number')
      .in('from_number', wsPhones)

    if (!convs?.length) return NextResponse.json({ counts: {} })

    const convIds = convs.map(c => c.id)
    const convPhoneMap = Object.fromEntries(convs.map(c => [c.id, c.from_number]))

    // Get distinct conversation_ids that have at least one unread inbound message
    const { data: unreadRows } = await supabaseAdmin
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .eq('direction', 'inbound')
      .is('read_at', null)

    // Count unread conversations per workspace phone number
    const unreadConvIds = new Set((unreadRows || []).map(r => r.conversation_id))
    const counts = {}
    for (const convId of unreadConvIds) {
      const phone = convPhoneMap[convId]
      if (phone) counts[phone] = (counts[phone] || 0) + 1
    }

    return NextResponse.json({ counts })
  } catch (err) {
    console.error('unread-counts error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
