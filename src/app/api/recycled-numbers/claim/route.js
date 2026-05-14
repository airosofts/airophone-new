import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    const messagingProfileId = request.headers.get('x-messaging-profile-id')
    if (!userId || !workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { recycled_number_id } = await request.json()
    if (!recycled_number_id) {
      return NextResponse.json({ error: 'recycled_number_id is required' }, { status: 400 })
    }

    // Atomically claim the number — only succeeds if it's still available
    // (or in expired quarantine). Prevents two users from grabbing the same number.
    const nowIso = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('recycled_numbers')
      .update({
        status: 'assigned',
        assigned_to_workspace_id: workspaceId,
        assigned_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', recycled_number_id)
      .or(`status.eq.available,and(status.eq.quarantine,quarantine_until.lt.${nowIso})`)
      .select('*')
      .maybeSingle()

    if (claimErr) {
      console.error('[recycled-numbers/claim] Claim error:', claimErr)
      return NextResponse.json({ error: 'Failed to claim number' }, { status: 500 })
    }

    if (!claimed) {
      return NextResponse.json({ error: 'Recycled number not found or already claimed' }, { status: 409 })
    }

    const phoneNumber = claimed.phone_number

    // Assign number to new messaging profile on Telnyx (best-effort)
    if (messagingProfileId && TELNYX_API_KEY) {
      await fetch(`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(phoneNumber)}/messaging`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
      }).catch((err) => console.warn('[recycled-numbers/claim] Telnyx profile assignment failed:', err.message))
    }

    // Upsert phone_numbers record for new workspace. Pricing fields are zeroed
    // because billing is now credit-based — the monthly cron deducts 100 credits
    // per number based on next_billing_at, set 30 days out.
    const nextBillingAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin.from('phone_numbers').upsert({
      phone_number: phoneNumber,
      workspace_id: workspaceId,
      messaging_profile_id: messagingProfileId || null,
      purchase_price: 0,
      monthly_price: 0,
      purchased_by: userId,
      status: 'active',
      is_active: true,
      next_billing_at: nextBillingAt,
      updated_at: nowIso,
    }, { onConflict: 'phone_number' })

    // Delete old conversations and messages for this number (from prior workspace)
    // This is deferred until claim so the original owner could still read history during quarantine
    const { data: oldConvos } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .or(`phone_number.eq.${phoneNumber},from_number.eq.${phoneNumber}`)

    if (oldConvos?.length) {
      const convoIds = oldConvos.map(c => c.id)
      await supabaseAdmin.from('messages').delete().in('conversation_id', convoIds)
      await supabaseAdmin.from('conversations').delete().in('id', convoIds)
    }

    return NextResponse.json({ success: true, phone_number: phoneNumber })
  } catch (error) {
    console.error('[recycled-numbers/claim]', error)
    return NextResponse.json({ error: error.message || 'Failed to claim number' }, { status: 500 })
  }
}
