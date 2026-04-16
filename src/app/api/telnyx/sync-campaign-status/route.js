// Syncs 10DLC campaign_status from Telnyx for all pending phone numbers in a workspace
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const CAMPAIGN_ID = process.env.TELNYX_CAMPAIGN_ID || '4b300199-1bcf-170e-e865-65d3d884f545'

export async function POST(request) {
  try {
    const workspaceId = request.headers.get('x-workspace-id')
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get all phone numbers for this workspace that are not yet approved
    const { data: numbers, error } = await supabaseAdmin
      .from('phone_numbers')
      .select('id, phone_number, campaign_status')
      .eq('workspace_id', workspaceId)
      .neq('campaign_status', 'approved')

    if (error || !numbers?.length) {
      return NextResponse.json({ success: true, synced: 0 })
    }

    let synced = 0

    for (const row of numbers) {
      const phone = row.phone_number
      if (!phone) continue

      try {
        const res = await fetch(
          `https://api.telnyx.com/v2/10dlc/phone_number_campaigns/${encodeURIComponent(phone)}`,
          { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } }
        )

        if (!res.ok) continue

        const data = await res.json()
        const assignmentStatus = data.assignmentStatus

        let newStatus = null
        if (assignmentStatus === 'ASSIGNED') newStatus = 'approved'
        else if (assignmentStatus === 'FAILED') newStatus = 'rejected'
        else if (assignmentStatus === 'PENDING_ASSIGNMENT') newStatus = 'pending'

        if (newStatus && newStatus !== row.campaign_status) {
          await supabaseAdmin
            .from('phone_numbers')
            .update({ campaign_status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', row.id)
          synced++
          console.log(`[sync-campaign-status] ${phone}: ${row.campaign_status} → ${newStatus}`)
        }
      } catch (err) {
        console.warn(`[sync-campaign-status] Failed to check ${phone}:`, err.message)
      }
    }

    return NextResponse.json({ success: true, synced, checked: numbers.length })
  } catch (error) {
    console.error('[sync-campaign-status] Error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
