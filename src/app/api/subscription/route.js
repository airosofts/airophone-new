import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET(request) {
  try {
    const workspaceId = request.headers.get('x-workspace-id')
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('credits')
      .eq('workspace_id', workspaceId)
      .single()

    return NextResponse.json({ success: true, subscription: sub || null, credits: wallet?.credits ?? 0 })
  } catch (error) {
    console.error('Subscription fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 })
  }
}
