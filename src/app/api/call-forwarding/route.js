import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

// GET - List forwarding rules for workspace
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createSupabaseServerClient()

    const { data: rules, error } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number, custom_name)')
      .eq('workspace_id', user.workspaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching forwarding rules:', error)
      return NextResponse.json({ error: 'Failed to fetch forwarding rules' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rules: rules || [] })
  } catch (error) {
    console.error('Error in call-forwarding GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a forwarding rule
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phone_number_id, forward_to } = await request.json()

    if (!phone_number_id || !forward_to) {
      return NextResponse.json(
        { error: 'Missing required fields: phone_number_id and forward_to' },
        { status: 400 }
      )
    }

    const supabase = createSupabaseServerClient()

    // Deactivate any existing active rule for this phone number
    await supabase
      .from('call_forwarding_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('phone_number_id', phone_number_id)
      .eq('is_active', true)

    // Create new rule
    const { data: rule, error } = await supabase
      .from('call_forwarding_rules')
      .insert({
        workspace_id: user.workspaceId,
        phone_number_id,
        forward_to,
        is_active: true,
        created_by: user.userId
      })
      .select('*, phone_numbers(phone_number, custom_name)')
      .single()

    if (error) {
      console.error('Error creating forwarding rule:', error)
      return NextResponse.json({ error: 'Failed to create forwarding rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rule })
  } catch (error) {
    console.error('Error in call-forwarding POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a forwarding rule (toggle active, change destination)
export async function PATCH(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, is_active, forward_to } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Missing rule id' }, { status: 400 })
    }

    const supabase = createSupabaseServerClient()

    const updates = { updated_at: new Date().toISOString() }
    if (typeof is_active === 'boolean') updates.is_active = is_active
    if (forward_to) updates.forward_to = forward_to

    const { data: rule, error } = await supabase
      .from('call_forwarding_rules')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .select('*, phone_numbers(phone_number, custom_name)')
      .single()

    if (error) {
      console.error('Error updating forwarding rule:', error)
      return NextResponse.json({ error: 'Failed to update forwarding rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rule })
  } catch (error) {
    console.error('Error in call-forwarding PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a forwarding rule
export async function DELETE(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing rule id' }, { status: 400 })
    }

    const supabase = createSupabaseServerClient()

    const { error } = await supabase
      .from('call_forwarding_rules')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)

    if (error) {
      console.error('Error deleting forwarding rule:', error)
      return NextResponse.json({ error: 'Failed to delete forwarding rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in call-forwarding DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
