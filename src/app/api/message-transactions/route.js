import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch message transactions for workspace
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')
    const campaignId = searchParams.get('campaign_id')
    const status = searchParams.get('status')

    let query = supabaseAdmin
      .from('message_transactions')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (campaignId) {
      query = query.eq('campaign_id', campaignId)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('Error fetching message transactions:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    // Get accumulated costs
    const { data: accumulatedData } = await supabaseAdmin.rpc(
      'get_workspace_accumulated_costs',
      { p_workspace_id: workspace.workspaceId }
    )

    // Get wallet balance
    const { data: walletData } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('workspace_id', workspace.workspaceId)
      .single()

    const walletBalance = walletData?.balance || 0
    const accumulatedCosts = accumulatedData || 0
    const availableBalance = walletBalance - accumulatedCosts

    return NextResponse.json({
      success: true,
      transactions,
      total: count,
      summary: {
        walletBalance,
        accumulatedCosts,
        availableBalance
      }
    })
  } catch (error) {
    console.error('Error in message transactions GET:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create a message transaction record
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      campaign_id,
      message_id,
      recipient_phone,
      cost_per_message = 0.02,
      message_type = 'sms',
      status = 'pending'
    } = body

    if (!recipient_phone) {
      return NextResponse.json(
        { success: false, error: 'Recipient phone is required' },
        { status: 400 }
      )
    }

    const transactionData = {
      workspace_id: workspace.workspaceId,
      user_id: user.userId,
      campaign_id,
      message_id,
      recipient_phone,
      cost_per_message,
      total_cost: cost_per_message,
      message_type,
      status
    }

    const { data: transaction, error } = await supabaseAdmin
      .from('message_transactions')
      .insert(transactionData)
      .select()
      .single()

    if (error) {
      console.error('Error creating message transaction:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      transaction
    })
  } catch (error) {
    console.error('Error in message transactions POST:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
