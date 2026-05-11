import { supabaseAdmin } from './supabase-server'

// Quarantine tier rule (by workspace tenure):
//   < 6 months  → 30 days
//   6–12 months → 45 days
//   12+ months  → 60 days
// Long-term customers get a longer grace period so their numbers aren't
// permanently released while they sort out payment issues.

const TIER_DAYS = { short: 30, mid: 45, long: 60 }

export async function getQuarantineDays(workspaceId) {
  if (!workspaceId) return TIER_DAYS.short

  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('created_at')
      .eq('id', workspaceId)
      .single()

    if (!ws?.created_at) return TIER_DAYS.short

    const ageDays = (Date.now() - new Date(ws.created_at).getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays >= 365) return TIER_DAYS.long
    if (ageDays >= 180) return TIER_DAYS.mid
    return TIER_DAYS.short
  } catch {
    return TIER_DAYS.short
  }
}

export async function getQuarantineUntilIso(workspaceId) {
  const days = await getQuarantineDays(workspaceId)
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}
