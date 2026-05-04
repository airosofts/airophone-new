import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

// GET /api/onboarding/tour-seen
// Returns { seen: boolean } — whether this user has already completed the inbox tour.
// If no onboarding_profiles row exists (legacy/invited users), returns seen: false
// so they will also see the tour.
export async function GET(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data } = await supabaseAdmin
      .from('onboarding_profiles')
      .select('inbox_tour_seen')
      .eq('user_id', userId)
      .single()

    // No row → legacy or invited user who skipped onboarding; show them the tour too
    if (!data) return NextResponse.json({ seen: false })

    return NextResponse.json({ seen: data.inbox_tour_seen === true })
  } catch {
    // Fail open — if something goes wrong, don't block the user
    return NextResponse.json({ seen: true })
  }
}

// PATCH /api/onboarding/tour-seen
// Marks the tour as seen for this user. Safe to call for users with or without
// an onboarding_profiles row (upserts only when a row already exists).
export async function PATCH(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Try UPDATE first (covers users who went through onboarding)
    const { data: existing } = await supabaseAdmin
      .from('onboarding_profiles')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (existing) {
      await supabaseAdmin
        .from('onboarding_profiles')
        .update({ inbox_tour_seen: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
    } else if (workspaceId) {
      // Invited/legacy user with no onboarding row — insert a minimal record
      await supabaseAdmin
        .from('onboarding_profiles')
        .insert({
          user_id: userId,
          workspace_id: workspaceId,
          onboarding_completed: true,
          inbox_tour_seen: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .onConflict('user_id')
        .ignoreDuplicates()
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // fail gracefully
  }
}
