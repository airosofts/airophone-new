import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: withdrawals } = await supabaseAdmin
    .from('referral_withdrawals')
    .select('id, amount, method, status, admin_note, processed_at, created_at')
    .eq('workspace_id', user.workspaceId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ withdrawals: withdrawals || [] })
}
