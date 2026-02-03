import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const { data: members, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, profile_photo_url, is_active, last_seen, role')
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('Error fetching team members:', error)
      return NextResponse.json(
        { error: 'Failed to fetch team members' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      members: members || []
    })

  } catch (error) {
    console.error('Error in team members API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}