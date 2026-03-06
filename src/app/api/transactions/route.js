import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  try {
    const workspaceId = request.headers.get('x-workspace-id')
    const userId = request.headers.get('x-user-id')

    if (!workspaceId && !userId) {
      return NextResponse.json({ error: 'Unauthorized - No workspace or user ID provided' }, { status: 401 })
    }

    // Get query parameters for pagination and filtering
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status') // pending, completed, failed

    // Query by workspace_id to show all members' topup transactions for the workspace
    let query = supabase
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .eq('type', 'topup')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId)
    } else {
      query = query.eq('user_id', userId)
    }

    // Apply status filter if provided
    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) throw error

    return NextResponse.json({
      success: true,
      transactions: data,
      total: count,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error fetching transactions:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
