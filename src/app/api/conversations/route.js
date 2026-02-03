import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

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

    if (conversationsError) {
      console.error('Error fetching conversations:', conversationsError)
      return NextResponse.json(
        { error: 'Failed to fetch conversations' },
        { status: 500 }
      )
    }

    // Process conversations to get the latest message for each
    const processedConversations = conversationsData.map(conv => {
      // Sort messages by created_at and get the latest one
      const sortedMessages = conv.messages.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      )
      
      return {
        ...conv,
        lastMessage: sortedMessages[0] || null,
        unreadCount: sortedMessages.filter(msg => 
          msg.direction === 'inbound' && !msg.read_at
        ).length,
        messages: undefined // Remove full messages array to keep response clean
      }
    })

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