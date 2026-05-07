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

    // Fetch the recycled number record
    const { data: rec, error: recErr } = await supabaseAdmin
      .from('recycled_numbers')
      .select('*')
      .eq('id', recycled_number_id)
      .or('status.eq.available,and(status.eq.quarantine,quarantine_until.lt.' + new Date().toISOString() + ')')
      .single()

    if (recErr || !rec) {
      return NextResponse.json({ error: 'Recycled number not found or not available' }, { status: 404 })
    }

    const phoneNumber = rec.phone_number

    // Assign number to new messaging profile on Telnyx (best-effort)
    if (messagingProfileId && TELNYX_API_KEY) {
      await fetch(`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(phoneNumber)}/messaging`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
      }).catch(() => {})
    }

    // Upsert phone_numbers record for new workspace (reuse existing row or create fresh)
    await supabaseAdmin.from('phone_numbers').upsert({
      phone_number: phoneNumber,
      workspace_id: workspaceId,
      messaging_profile_id: messagingProfileId || null,
      purchase_price: 0,
      monthly_price: 1.00,
      purchased_by: userId,
      status: 'active',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number' })

    // Mark recycled number as assigned
    await supabaseAdmin
      .from('recycled_numbers')
      .update({
        status: 'assigned',
        assigned_to_workspace_id: workspaceId,
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', recycled_number_id)

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
