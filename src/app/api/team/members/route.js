import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = user.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace context' }, { status: 400 })
    }

    // Get active workspace members via join table
    const { data: memberships, error } = await supabaseAdmin
      .from('workspace_members')
      .select(`
        user_id,
        role,
        users (
          id,
          name,
          email,
          profile_photo_url,
          is_active
        )
      `)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)

    if (error) {
      console.error('Error fetching team members:', error)
      return NextResponse.json(
        { error: 'Failed to fetch team members' },
        { status: 500 }
      )
    }

    // Flatten the joined data and filter out inactive users
    const members = (memberships || [])
      .filter(m => m.users?.is_active)
      .map(m => ({
        id: m.users.id,
        name: m.users.name,
        email: m.users.email,
        profile_photo_url: m.users.profile_photo_url,
        role: m.role
      }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

    return NextResponse.json({
      success: true,
      members
    })

  } catch (error) {
    console.error('Error in team members API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
