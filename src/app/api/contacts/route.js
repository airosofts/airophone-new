// app/api/contacts/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch contacts
export async function GET(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const contactListId = searchParams.get('contact_list_id')

    let query = supabaseAdmin
      .from('contacts')
      .select(`
        *,
        contact_lists(id, name)
      `)
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (contactListId) {
      query = query.eq('contact_list_id', contactListId)
    }

    const { data: contacts, error } = await query

    if (error) {
      console.error('Database error fetching contacts:', error)
      return NextResponse.json(
        { error: 'Failed to fetch contacts', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      contacts: contacts || []
    })

  } catch (error) {
    console.error('Error in contacts GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create contact
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

    const { business_name, phone_number, email, city, state, country, contact_list_id } = body

    if (!business_name?.trim() || !phone_number?.trim()) {
      return NextResponse.json(
        { error: 'Business name and phone number are required' },
        { status: 400 }
      )
    }

    const contactData = {
      business_name: business_name.trim(),
      phone_number: phone_number.trim(),
      email: email?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      country: country?.trim() || null,
      contact_list_id: contact_list_id || null,
      workspace_id: workspace.workspaceId,
      created_by: user.userId
    }

    const { data: contact, error } = await supabaseAdmin
      .from('contacts')
      .insert(contactData)
      .select()
      .single()

    if (error) {
      console.error('Database error creating contact:', error)
      return NextResponse.json(
        { error: 'Failed to create contact', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      contact
    })

  } catch (error) {
    console.error('Error in contacts POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// PUT - Update contact
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
    const contactId = searchParams.get('id')
    const body = await request.json()

    if (!contactId) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      )
    }

    const { business_name, phone_number, email, city, state, country } = body

    const updateData = {}
    if (business_name !== undefined) updateData.business_name = business_name.trim()
    if (phone_number !== undefined) updateData.phone_number = phone_number.trim()
    if (email !== undefined) updateData.email = email?.trim() || null
    if (city !== undefined) updateData.city = city?.trim() || null
    if (state !== undefined) updateData.state = state?.trim() || null
    if (country !== undefined) updateData.country = country?.trim() || null

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update(updateData)
      .eq('id', contactId)
      .eq('workspace_id', workspace.workspaceId)
      .select()
      .single()

    if (error) {
      console.error('Database error updating contact:', error)
      return NextResponse.json(
        { error: 'Failed to update contact', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      contact: data
    })

  } catch (error) {
    console.error('Error in contacts PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// DELETE - Delete contact
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
    const contactId = searchParams.get('id')

    if (!contactId) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      )
    }

    const { error } = await supabaseAdmin
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('workspace_id', workspace.workspaceId)

    if (error) {
      console.error('Database error deleting contact:', error)
      return NextResponse.json(
        { error: 'Failed to delete contact', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Contact deleted successfully'
    })

  } catch (error) {
    console.error('Error in contacts DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}