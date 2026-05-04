import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // If user already has a workspace with phone numbers, they've completed setup —
    // skip onboarding regardless of what the onboarding_profiles record says
    if (workspaceId) {
      const { count } = await supabaseAdmin
        .from('phone_numbers')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)

      if (count && count > 0) {
        // Auto-heal the record so this check doesn't run repeatedly
        await supabaseAdmin
          .from('onboarding_profiles')
          .update({ onboarding_completed: true })
          .eq('user_id', userId)
          .eq('onboarding_completed', false)

        return NextResponse.json({ onboarding_completed: true })
      }
    }

    const { data } = await supabaseAdmin
      .from('onboarding_profiles')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .single()

    // If no profile exists, user hasn't started onboarding (existing users before this feature)
    // Return completed = true so they aren't blocked
    if (!data) {
      return NextResponse.json({ onboarding_completed: true })
    }

    return NextResponse.json({ onboarding_completed: data.onboarding_completed })
  } catch (error) {
    console.error('Onboarding status error:', error)
    return NextResponse.json({ onboarding_completed: true }) // fail open
  }
}
