// Sweep due scheduled SMS and send them. Called every minute by followup-cron
// with `Authorization: Bearer CRON_SECRET`.
//   condition='unless_first' → if the recipient replied after we scheduled, cancel.
//   condition='always'       → always send when due.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { getWorkspaceMessageRate } from '@/lib/pricing'

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()
  const { data: due } = await supabaseAdmin
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(100)

  let sent = 0, canceled = 0, failed = 0

  for (const row of (due || [])) {
    // Atomically claim the row so overlapping ticks can't double-send.
    const { data: claimed } = await supabaseAdmin
      .from('scheduled_messages')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    // "Unless they message first": cancel if the recipient replied after scheduling.
    if (row.condition === 'unless_first' && row.conversation_id) {
      const { data: replies } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('conversation_id', row.conversation_id)
        .eq('direction', 'inbound')
        .gt('created_at', row.created_at)
        .limit(1)
      if (replies && replies.length > 0) {
        await supabaseAdmin.from('scheduled_messages')
          .update({ status: 'canceled', cancel_reason: 'recipient_replied', updated_at: new Date().toISOString() })
          .eq('id', row.id)
        canceled++
        continue
      }
    }

    const media = Array.isArray(row.media_urls) ? row.media_urls.map(m => m.url).filter(Boolean) : []
    const options = media.length ? { media_urls: media } : {}
    const result = await telnyx.sendMessage(row.from_number, row.to_number, row.body || '', options)

    if (!result.success) {
      await supabaseAdmin.from('scheduled_messages')
        .update({ status: 'failed', cancel_reason: 'send_failed', updated_at: new Date().toISOString() })
        .eq('id', row.id)
      failed++
      continue
    }

    // Record the sent message in the conversation.
    const { data: msg } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: row.conversation_id,
        telnyx_message_id: result.messageId,
        direction: 'outbound',
        from_number: row.from_number,
        to_number: row.to_number,
        body: row.body || '',
        media_urls: row.media_urls || null,
        status: 'sent',
        user_id: row.created_by || null,
      })
      .select('id')
      .single()

    // Charge for the send (best-effort — message already went out).
    try {
      const rate = await getWorkspaceMessageRate(row.workspace_id)
      await supabaseAdmin.rpc('deduct_message_cost', {
        p_user_id: row.created_by,
        p_workspace_id: row.workspace_id,
        p_message_count: 1,
        p_cost_per_message: rate,
        p_description: `Scheduled SMS to ${row.to_number}`,
        p_campaign_id: null,
        p_message_id: msg?.id,
        p_recipient_phone: row.to_number,
      })
    } catch (e) { console.error('[process-scheduled] deduct error:', e.message) }

    await supabaseAdmin.from('scheduled_messages')
      .update({ status: 'sent', sent_message_id: msg?.id || null, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    sent++
  }

  return NextResponse.json({ picked: (due || []).length, sent, canceled, failed })
}
