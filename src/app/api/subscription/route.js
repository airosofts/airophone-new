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

    // Detect expired trial (status still trialing but trial_end has passed)
    let trialExpired = false
    let trialExpiredDaysAgo = 0
    if (sub?.status === 'trialing' && sub?.trial_end) {
      const trialEndMs = new Date(sub.trial_end).getTime()
      if (trialEndMs < Date.now()) {
        trialExpired = true
        trialExpiredDaysAgo = Math.floor((Date.now() - trialEndMs) / (1000 * 60 * 60 * 24))
      }
    }

    // Check quarantine state — relevant for past_due or expired trial (7+ days)
    let numbersQuarantined = false
    const needsQuarantineCheck = sub?.status === 'past_due' || (trialExpired && trialExpiredDaysAgo >= 7)
    if (needsQuarantineCheck) {
      const { data: alreadyQuarantined } = await supabaseAdmin
        .from('recycled_numbers')
        .select('id')
        .eq('original_workspace_id', workspaceId)
        .eq('status', 'quarantine')
        .limit(1)
        .maybeSingle()
      numbersQuarantined = !!alreadyQuarantined

      // Trial expired 7+ days ago but quarantine not yet triggered — do it now
      if (trialExpired && trialExpiredDaysAgo >= 7 && !numbersQuarantined) {
        try {
          const quarantineUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          const { data: wsNumbers } = await supabaseAdmin
            .from('phone_numbers')
            .select('phone_number, messaging_profile_id')
            .eq('workspace_id', workspaceId)
            .eq('is_active', true)

          if (wsNumbers?.length) {
            const profileIdsToDelete = new Set()
            for (const n of wsNumbers) {
              const { data: existing } = await supabaseAdmin
                .from('recycled_numbers')
                .select('id, status')
                .eq('phone_number', n.phone_number)
                .not('status', 'eq', 'assigned')
                .maybeSingle()

              if (!existing) {
                await supabaseAdmin.from('recycled_numbers').insert({
                  phone_number: n.phone_number,
                  original_workspace_id: workspaceId,
                  telnyx_messaging_profile_id: n.messaging_profile_id,
                  status: 'quarantine',
                  quarantine_until: quarantineUntil,
                  failed_payment_at: sub.trial_end,
                  entered_cycle_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
              } else if (existing.status === 'pending') {
                await supabaseAdmin.from('recycled_numbers').update({
                  status: 'quarantine',
                  quarantine_until: quarantineUntil,
                  updated_at: new Date().toISOString(),
                }).eq('id', existing.id)
              }

              await supabaseAdmin.from('phone_numbers')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('phone_number', n.phone_number)
                .eq('workspace_id', workspaceId)

              if (n.messaging_profile_id) profileIdsToDelete.add(n.messaging_profile_id)
            }

            for (const profileId of profileIdsToDelete) {
              fetch(`https://api.telnyx.com/v2/messaging_profiles/${profileId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
              }).catch(() => {})
            }

            numbersQuarantined = true
          }
        } catch (err) {
          console.error('[subscription] Trial quarantine trigger failed:', err.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      subscription: sub || null,
      credits: wallet?.credits ?? 0,
      numbersQuarantined,
      trialExpired,
      trialExpiredDaysAgo,
    })
  } catch (error) {
    console.error('Subscription fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 })
  }
}
