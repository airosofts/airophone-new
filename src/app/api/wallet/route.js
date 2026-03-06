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

    // Look up wallet by workspace_id (shared across all members) or fall back to user_id
    let query = supabase
      .from('wallets')
      .select('credits, balance, currency, created_at')

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId)
    } else {
      query = query.eq('user_id', userId)
    }

    const { data: wallet, error } = await query.single()

    if (error) {
      console.error('Wallet error:', error)
      // If wallet doesn't exist, create one
      if (error.code === 'PGRST116') {
        const insertData = { credits: 0.00, balance: 0.00, currency: 'USD' }
        if (workspaceId) insertData.workspace_id = workspaceId
        if (userId) insertData.user_id = userId

        const { error: createError } = await supabase
          .from('wallets')
          .insert(insertData)
          .select()
          .single()

        if (createError) throw createError

        return NextResponse.json({
          success: true,
          balance: 0.00,
          credits: 0.00,
          currency: 'USD'
        })
      }
      throw error
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
