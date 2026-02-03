import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function GET(request) {
  try {
    // Get user ID from header (sent from client)
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized - No user ID provided' }, { status: 401 })
    }

    // Get wallet data - now returning credits instead of balance
    const { data: wallet, error } = await supabase
      .from('wallets')
      .select('credits, balance, currency, created_at')
      .eq('user_id', userId)
      .single()

    if (error) {
      console.error('Wallet error:', error)
      // If wallet doesn't exist, create one
      if (error.code === 'PGRST116') {
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({ user_id: userId, credits: 0.00, balance: 0.00, currency: 'USD' })
          .select()
          .single()

        if (createError) throw createError

        return NextResponse.json({
          success: true,
          balance: 0.00, // Return credits as balance for compatibility
          credits: 0.00,
          currency: 'USD'
        })
      }
      throw error
    }

    return NextResponse.json({
      success: true,
      balance: parseFloat(wallet.credits || wallet.balance || 0), // Return credits as balance for frontend compatibility
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
