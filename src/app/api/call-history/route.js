import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    const supabase = createSupabaseServerClient()

    // Query calls scoped to workspace
    let query = supabase
      .from('calls')
      .select('*', { count: 'exact' })
      .eq('workspace_id', user.workspaceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filter === 'forwarded') {
      query = query.not('forwarded_to', 'is', null)
    }

    const { data: calls, error, count } = await query

    if (error) {
      console.error('Error fetching call history:', error)
      return NextResponse.json({ error: 'Failed to fetch call history' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      calls: calls || [],
      total: count || 0,
      page,
      limit
    })
  } catch (error) {
    console.error('Error in call-history GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
