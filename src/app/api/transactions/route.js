import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Get the wallet owner's user_id for a given user (shared workspace wallet)
async function getWalletUserId(userId) {
  // Find user's workspace
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership?.workspace_id) return userId

  // Find the wallet for this workspace to get its owner user_id
  const { data: wallet } = await supabase
    .from('wallets')
    .select('user_id')
    .eq('workspace_id', membership.workspace_id)
    .single()

  return wallet?.user_id || userId
}

export async function GET(request) {
  try {
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status')

    // Resolve wallet owner's user_id (shared workspace wallet)
    const walletUserId = await getWalletUserId(userId)

    let query = supabase
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', walletUserId)
      .eq('type', 'topup')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

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
