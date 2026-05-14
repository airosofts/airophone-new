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

    let query = supabaseAdmin
      .from('conversations')
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
      `)
      .in('from_number', workspacePhoneNumbers)


    // Filter by specific from_number if provided
    if (fromNumber) {
      // Verify the requested number belongs to this workspace
      if (!workspacePhoneNumbers.includes(fromNumber)) {
        return NextResponse.json({ error: 'Access denied to this phone number' }, { status: 403 })
      }
      query = query.eq('from_number', fromNumber)
    }

    const { data: conversationsData, error: conversationsError } = await query
      .order('last_message_at', { ascending: false })
      // PostgREST default cap is 1000 — busy workspaces silently lost the
      // older conversations. Raise to 50k so the inbox shows everything.
      .range(0, 49999)

    if (conversationsError) {
      console.error('Error fetching conversations:', conversationsError)
      return NextResponse.json(
        { error: 'Failed to fetch conversations' },
        { status: 500 }
      )
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
          .select('phone_number, first_name, last_name, business_name')
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
              business_name: c.business_name || null
            }
            if (c.phone_number) contactMap[c.phone_number] = entry
            const normalized = normalizePhone(c.phone_number)
            if (normalized && normalized !== c.phone_number) contactMap[normalized] = entry
          }
        }
      }
      console.log(`[ContactMap] Found ${Object.keys(contactMap).length} contact entries for ${phonesToQuery.length} phones`)
    }

    // Process conversations to get the latest message for each
    const processedConversations = visibleConversations.map(conv => {
      const sortedMessages = conv.messages.sort((a, b) =>
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
        name: contactName || conv.name || null,
        lastMessage: sortedMessages[0] || null,
        unreadCount: sortedMessages.filter(msg =>
          msg.direction === 'inbound' && !msg.read_at
        ).length,
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