// app/api/contact-lists/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch all contact lists with contact counts
export async function GET(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    // Get contact lists for workspace
    const { data: contactLists, error: listsError } = await supabaseAdmin
      .from('contact_lists')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (listsError) {
      console.error('Database error fetching contact lists:', listsError)
      return NextResponse.json(
        { error: 'Failed to fetch contact lists', details: listsError.message },
        { status: 500 }
      )
    }

    // Get contact counts for each list (workspace-filtered)
    const listsWithCounts = await Promise.all(
      (contactLists || []).map(async (list) => {
        const { count } = await supabaseAdmin
          .from('contacts')
          .select('*', { count: 'exact', head: true })
          .eq('contact_list_id', list.id)
          .eq('workspace_id', workspace.workspaceId)

        return {
          ...list,
          contactCount: count || 0
        }
      })
    )

    return NextResponse.json({
      success: true,
      contactLists: listsWithCounts
    })

  } catch (error) {
    console.error('Error in contact lists GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new contact list
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const { name, description } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    const listData = {
      name: name.trim(),
      description: description?.trim() || null,
      workspace_id: workspace.workspaceId,
      created_by: user.userId
    }

    const { data: contactList, error } = await supabaseAdmin
      .from('contact_lists')
      .insert(listData)
      .select()
      .single()

    if (error) {
      console.error('Database error creating contact list:', error)
      return NextResponse.json(
        { error: 'Failed to create contact list', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      contactList: {
        ...contactList,
        contactCount: 0
      }
    })

  } catch (error) {
    console.error('Error in contact lists POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// PUT - Update contact list
export async function PUT(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const listId = searchParams.get('id')
    const body = await request.json()

    if (!listId) {
      return NextResponse.json(
        { error: 'List ID is required' },
        { status: 400 }
      )
    }

    const { name, description } = body

    const updateData = {}
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null

    const { data, error } = await supabaseAdmin
      .from('contact_lists')
      .update(updateData)
      .eq('id', listId)
      .eq('workspace_id', workspace.workspaceId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating contact list:', error)
      return NextResponse.json(
        { error: 'Failed to update contact list', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      contactList: data
    })

  } catch (error) {
    console.error('Error in contact lists PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// DELETE - Delete contact list with CASCADE handling
export async function DELETE(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const listId = searchParams.get('id')

    if (!listId) {
      return NextResponse.json(
        { error: 'List ID is required' },
        { status: 400 }
      )
    }

    // Step 1: Get all contacts in this list (workspace-filtered)
    const { data: contacts, error: contactsFetchError } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('contact_list_id', listId)
      .eq('workspace_id', workspace.workspaceId)

    if (contactsFetchError) {
      console.error('Error fetching contacts:', contactsFetchError)
      return NextResponse.json(
        { error: 'Failed to fetch contacts for deletion' },
        { status: 500 }
      )
    }

    const contactIds = contacts?.map(c => c.id) || []

    // Step 2: Delete campaign_messages references
    if (contactIds.length > 0) {
      const { error: messagesDeleteError } = await supabaseAdmin
        .from('campaign_messages')
        .delete()
        .in('contact_id', contactIds)

      if (messagesDeleteError) {
        console.error('Error deleting campaign messages:', messagesDeleteError)
      }
    }

    // Step 3: Delete all contacts in the list
    const { error: contactsDeleteError } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('contact_list_id', listId)
      .eq('workspace_id', workspace.workspaceId)

    if (contactsDeleteError) {
      console.error('Error deleting contacts:', contactsDeleteError)
      return NextResponse.json(
        { error: 'Failed to delete contacts' },
        { status: 500 }
      )
    }

    // Step 4: Delete the list itself
    const { error: listDeleteError } = await supabaseAdmin
      .from('contact_lists')
      .delete()
      .eq('id', listId)
      .eq('workspace_id', workspace.workspaceId)

    if (listDeleteError) {
      console.error('Error deleting contact list:', listDeleteError)
      return NextResponse.json(
        { error: 'Failed to delete contact list' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Contact list and all associated data deleted successfully'
    })

  } catch (error) {
    console.error('Error in contact lists DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
