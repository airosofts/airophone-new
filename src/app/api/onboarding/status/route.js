import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
