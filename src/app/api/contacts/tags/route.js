import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const lists = searchParams.get('lists')

    if (!lists) {
      return NextResponse.json({
        success: true,
        tags: ['business_name', 'phone', 'email', 'city', 'state', 'country']
      })
    }

    const listIds = lists.split(',')

    // Get sample contact to determine available fields
    const { data: sampleContact, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .in('contact_list_id', listIds)
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching sample contact:', error)
      return NextResponse.json(
        { error: 'Failed to fetch contact fields' },
        { status: 500 }
      )
    }

    // Default available tags (using 'phone' instead of 'phone_number' for cleaner template)
    const availableTags = ['business_name', 'phone', 'email', 'city', 'state', 'country']

    return NextResponse.json({
      success: true,
      tags: availableTags
    })

  } catch (error) {
    console.error('Error in contact tags API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}