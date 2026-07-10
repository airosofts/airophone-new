import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

function normalizePhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+1${digits}`
}

export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspace = getWorkspaceFromRequest(request)
    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized - No workspace context' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const fromNumber = searchParams.get('from_number')

    // Get all phone numbers for this workspace
    const { data: workspacePhones, error: phonesError } = await supabaseAdmin
      .from('phone_numbers')
      .select('phone_number')
      .eq('workspace_id', workspace.workspaceId)
      .eq('is_active', true)

    if (phonesError) {
      console.error('Error fetching workspace phone numbers:', phonesError)
      return NextResponse.json({ error: 'Failed to fetch workspace phone numbers' }, { status: 500 })
    }

    const workspacePhoneNumbers = workspacePhones?.map(p => p.phone_number) || []

    if (workspacePhoneNumbers.length === 0) {
      // No phone numbers for this workspace
      return NextResponse.json({
        success: true,
        conversations: []
      })
    }

    // Fetch blocked phone numbers for this workspace
    const { data: blockedRows } = await supabaseAdmin
      .from('blocked_contacts')
      .select('phone_number')
      .eq('workspace_id', workspace.workspaceId)

    const blockedNumbers = (blockedRows || []).map(r => r.phone_number)

    // Verify the requested number belongs to this workspace
    if (fromNumber && !workspacePhoneNumbers.includes(fromNumber)) {
      return NextResponse.json({ error: 'Access denied to this phone number' }, { status: 403 })
    }

    // Supabase clamps EVERY query to its "Max rows" setting (db-max-rows,
    // default 1000) — .range() beyond that is silently truncated, which hid
    // older conversations (and their unread badges) on busy lines. This loop
    // is ADAPTIVE: it asks for up to WINDOW rows and advances by however many
    // the server actually returned. If Max rows is raised in the Supabase
    // dashboard this becomes a single round trip; at the default clamp it
    // pages in 1000-row chunks instead of truncating. A page shorter than
    // MIN_CLAMP means the data is exhausted (the clamp is never below 1000).
    // Each conversation embeds ONLY its latest message (per-parent
    // order+limit) instead of its full history; unread counts come from the
    // separate query below. Both changes keep the response small at 1000s of
    // chats.
    const WINDOW = 50000
    const conversationsData = []
    for (let offset = 0, total = null; ; ) {
      let query = supabaseAdmin
        .from('conversations')
        // count: 'exact' returns the TRUE total alongside the rows, so the
        // loop knows precisely when it has everything — one request when the
        // server allows it, no trailing empty probe, and still correct if
        // Max rows is ever lowered again.
        .select(`
          *,
          messages!inner (
            id,
            body,
            direction,
            status,
            created_at,
            read_at,
            from_number,
            to_number,
            telnyx_message_id
          )
        `, { count: 'exact' })
        .in('from_number', workspacePhoneNumbers)
      if (fromNumber) query = query.eq('from_number', fromNumber)

      const { data: pageRows, count, error: conversationsError } = await query
        .order('last_message_at', { ascending: false })
        // Stable tiebreak so paging never skips/duplicates rows that share
        // the same last_message_at.
        .order('id', { ascending: true })
        .order('created_at', { referencedTable: 'messages', ascending: false })
        .limit(1, { referencedTable: 'messages' })
        .range(offset, offset + WINDOW - 1)

      if (conversationsError) {
        console.error('Error fetching conversations:', conversationsError)
        return NextResponse.json(
          { error: 'Failed to fetch conversations' },
          { status: 500 }
        )
      }
      conversationsData.push(...(pageRows || []))
      if (total === null) total = count ?? 0
      if (!pageRows || pageRows.length === 0 || conversationsData.length >= total) break
      offset += pageRows.length
    }

    // Unread inbound messages per conversation. Starting from the (small) set
    // of unread messages instead of counting inside the conversations embed —
    // same trick as /api/conversations/unread-counts — with the same adaptive
    // paging.
    const unreadByConversation = new Map()
    for (let offset = 0, total = null, fetched = 0; ; ) {
      let unreadQuery = supabaseAdmin
        .from('messages')
        .select('id, conversation_id, conversations!inner(from_number)', { count: 'exact' })
        .eq('direction', 'inbound')
        .is('read_at', null)
        .in('conversations.from_number', workspacePhoneNumbers)
      if (fromNumber) unreadQuery = unreadQuery.eq('conversations.from_number', fromNumber)

      const { data: unreadRows, count, error: unreadError } = await unreadQuery
        .order('id', { ascending: true })
        .range(offset, offset + WINDOW - 1)

      if (unreadError) {
        console.error('Error fetching unread counts:', unreadError)
        break   // degrade to zero badges rather than failing the whole inbox
      }
      for (const row of (unreadRows || [])) {
        unreadByConversation.set(row.conversation_id, (unreadByConversation.get(row.conversation_id) || 0) + 1)
      }
      fetched += unreadRows?.length || 0
      if (total === null) total = count ?? 0
      if (!unreadRows || unreadRows.length === 0 || fetched >= total) break
      offset += unreadRows.length
    }

    // Filter out blocked contacts
    const visibleConversations = blockedNumbers.length > 0
      ? conversationsData.filter(conv => !blockedNumbers.includes(conv.phone_number))
      : conversationsData

    // Fetch contacts matching conversation phone numbers (avoids Supabase 1000-row limit)
    let contactMap = {}
    if (visibleConversations.length > 0) {
      const rawPhones = visibleConversations.map(c => c.phone_number).filter(Boolean)
      const normalizedPhones = rawPhones.map(p => normalizePhone(p)).filter(Boolean)
      const phonesToQuery = [...new Set([...rawPhones, ...normalizedPhones])]

      // Query in batches of 100 to stay within URL length limits
      const batchSize = 100
      for (let i = 0; i < phonesToQuery.length; i += batchSize) {
        const batch = phonesToQuery.slice(i, i + batchSize)
        const { data: contactRows, error: contactError } = await supabaseAdmin
          .from('contacts')
          .select('phone_number, first_name, last_name, business_name, status')
          .eq('workspace_id', workspace.workspaceId)
          .in('phone_number', batch)

        if (contactError) {
          console.error('[ContactMap] Batch error:', contactError)
          continue
        }

        if (contactRows) {
          for (const c of contactRows) {
            const entry = {
              first_name: c.first_name || null,
              last_name: c.last_name || null,
              business_name: c.business_name || null,
              status: c.status || null
            }
            // Duplicate rows can share a phone. Don't let a status-less duplicate
            // overwrite one that already carries a status (or a name) — prefer the
            // richer entry so the list badge reflects the real disposition.
            const better = (key) => {
              const prev = contactMap[key]
              if (!prev) return true
              if (!prev.status && entry.status) return true
              if (!prev.first_name && !prev.last_name && (entry.first_name || entry.last_name)) return true
              return false
            }
            if (c.phone_number && better(c.phone_number)) contactMap[c.phone_number] = entry
            const normalized = normalizePhone(c.phone_number)
            if (normalized && normalized !== c.phone_number && better(normalized)) contactMap[normalized] = entry
          }
        }
      }
      console.log(`[ContactMap] Found ${Object.keys(contactMap).length} contact entries for ${phonesToQuery.length} phones`)
    }

    // Process conversations — the embed is already just the latest message
    // (defensive sort in case the embed limit ever returns more than one).
    const processedConversations = visibleConversations.map(conv => {
      const sortedMessages = (conv.messages || []).sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      )

      // Try exact match, then normalized match
      const contact = contactMap[conv.phone_number] || contactMap[normalizePhone(conv.phone_number)]
      const contactFirstName = contact?.first_name || null
      const contactLastName = contact?.last_name || null
      const contactBusinessName = contact?.business_name || null
      const contactName = contact
        ? ([contactFirstName, contactLastName].filter(Boolean).join(' ') || contactBusinessName || null)
        : null

      return {
        ...conv,
        contact_first_name: contactFirstName,
        contact_last_name: contactLastName,
        contact_status: contact?.status || null,
        name: contactName || conv.name || null,
        lastMessage: sortedMessages[0] || null,
        unreadCount: unreadByConversation.get(conv.id) || 0,
        messages: undefined
      }
    })

    // Attach lastCall to each conversation — match by phone numbers (not conversation_id
    // since older calls may not have it set)
    if (processedConversations.length > 0) {
      const { data: callRows } = await supabaseAdmin
        .from('calls')
        .select('from_number, to_number, direction, status, created_at, duration_seconds')
        .eq('workspace_id', workspace.workspaceId)
        .order('created_at', { ascending: false })
        .limit(2000)

      // Build map keyed by "wsPhone10|contactPhone10" → most recent call
      const normalizedWsPhones = new Set(workspacePhoneNumbers.map(p => p.replace(/\D/g, '').slice(-10)))
      const callByPhones = {}
      for (const call of (callRows || [])) {
        const fn = call.from_number?.replace(/\D/g, '').slice(-10)
        const tn = call.to_number?.replace(/\D/g, '').slice(-10)
        if (!fn || !tn) continue
        let wsPhone, contactPhone
        if (normalizedWsPhones.has(fn)) { wsPhone = fn; contactPhone = tn }
        else if (normalizedWsPhones.has(tn)) { wsPhone = tn; contactPhone = fn }
        else continue
        const key = `${wsPhone}|${contactPhone}`
        if (!callByPhones[key]) callByPhones[key] = call
      }

      for (const conv of processedConversations) {
        const wsPhone = conv.from_number?.replace(/\D/g, '').slice(-10)
        const contactPhone = conv.phone_number?.replace(/\D/g, '').slice(-10)
        conv.lastCall = callByPhones[`${wsPhone}|${contactPhone}`] || null
      }
    }

    console.log(`Fetched ${processedConversations.length} conversations for ${fromNumber || 'all numbers'}`)

    return NextResponse.json({
      success: true,
      conversations: processedConversations
    })

  } catch (error) {
    console.error('Error in conversations API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}