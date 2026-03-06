import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Get workspace_id for a user (all members share the same workspace wallet)
async function getWorkspaceId(userId) {
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single()

  return membership?.workspace_id || null
}

export async function GET(request) {
  try {
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    // Try to find wallet by workspace_id first (shared workspace wallet)
    const workspaceId = await getWorkspaceId(userId)

    let wallet = null
    let walletError = null

    if (workspaceId) {
      const { data, error } = await supabase
        .from('wallets')
        .select('credits, balance, currency, created_at')
        .eq('workspace_id', workspaceId)
        .single()
      wallet = data
      walletError = error
    }

    // Fallback: look up by user_id directly
    if (!wallet) {
      const { data, error } = await supabase
        .from('wallets')
        .select('credits, balance, currency, created_at')
        .eq('user_id', userId)
        .single()
      wallet = data
      walletError = error
    }

    if (walletError && walletError.code !== 'PGRST116') {
      throw walletError
    }

    if (!wallet) {
      return NextResponse.json({ success: true, balance: 0, credits: 0, currency: 'USD' })
    }

    return NextResponse.json({
      success: true,
      balance: parseFloat(wallet.credits || wallet.balance || 0),
      credits: parseFloat(wallet.credits || 0),
      currency: wallet.currency
    })
  } catch (error) {
    console.error('Error fetching wallet:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
