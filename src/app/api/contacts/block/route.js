import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET /api/contacts/block  — list all blocked numbers for the workspace
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('blocked_contacts')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ success: true, blocked: data || [] })
  } catch (error) {
    console.error('Error fetching blocked contacts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/contacts/block  — block a phone number
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phoneNumber } = await request.json()
    if (!phoneNumber) {
      return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('blocked_contacts')
      .upsert({
        workspace_id: workspace.workspaceId,
        phone_number: phoneNumber,
        blocked_by: user.userId
      }, { onConflict: 'workspace_id,phone_number' })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error blocking contact:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/contacts/block  — unblock a phone number
export async function DELETE(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace?.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const phoneNumber = searchParams.get('phoneNumber')
    if (!phoneNumber) {
      return NextResponse.json({ error: 'phoneNumber is required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('blocked_contacts')
      .delete()
      .eq('workspace_id', workspace.workspaceId)
      .eq('phone_number', phoneNumber)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error unblocking contact:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
