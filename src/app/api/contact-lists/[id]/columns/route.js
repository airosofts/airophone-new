import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch columns for a contact list
export async function GET(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const { data: columns, error } = await supabaseAdmin
      .from('contact_list_columns')
      .select('*')
      .eq('contact_list_id', id)
      .eq('workspace_id', workspace.workspaceId)
      .order('position', { ascending: true })

    if (error) {
      console.error('Error fetching columns:', error)
      return NextResponse.json({ error: 'Failed to fetch columns' }, { status: 500 })
    }

    return NextResponse.json({ success: true, columns: columns || [] })
  } catch (error) {
    console.error('Error in columns GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new column
export async function POST(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { label, column_type = 'text' } = body

    if (!label?.trim()) {
      return NextResponse.json({ error: 'Label is required' }, { status: 400 })
    }

    // Generate key from label (slug)
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

    // Get max position
    const { data: existing } = await supabaseAdmin
      .from('contact_list_columns')
      .select('position')
      .eq('contact_list_id', id)
      .order('position', { ascending: false })
      .limit(1)

    const position = existing?.[0] ? existing[0].position + 1 : 0

    const { data: column, error } = await supabaseAdmin
      .from('contact_list_columns')
      .insert({
        contact_list_id: id,
        workspace_id: workspace.workspaceId,
        key,
        label: label.trim(),
        column_type,
        position
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `Column "${key}" already exists in this list` }, { status: 409 })
      }
      console.error('Error creating column:', error)
      return NextResponse.json({ error: 'Failed to create column' }, { status: 500 })
    }

    return NextResponse.json({ success: true, column })
  } catch (error) {
    console.error('Error in columns POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a column by key
export async function DELETE(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const columnId = searchParams.get('column_id')

    if (!columnId) {
      return NextResponse.json({ error: 'column_id is required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('contact_list_columns')
      .delete()
      .eq('id', columnId)
      .eq('contact_list_id', id)
      .eq('workspace_id', workspace.workspaceId)

    if (error) {
      console.error('Error deleting column:', error)
      return NextResponse.json({ error: 'Failed to delete column' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in columns DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
