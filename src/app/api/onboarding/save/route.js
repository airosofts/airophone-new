import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()

    // Upsert onboarding profile
    const { data: existing } = await supabaseAdmin
      .from('onboarding_profiles')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (existing) {
      const { error } = await supabaseAdmin
        .from('onboarding_profiles')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('onboarding_profiles')
        .insert({ user_id: userId, workspace_id: workspaceId, ...body })
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Onboarding save error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
