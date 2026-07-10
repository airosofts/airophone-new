// SMS campaign queue sweeper — the cron-driven sender (RVM-parity).
// Per tick it claims a batch of queued campaign_messages and sends them, gated
// by the campaign's schedule. Gates (all must pass or the row stays queued):
//   • startReached — scheduled_at (send-later) has arrived
//   • inWindow     — "now" is inside the send windows + days (business hours)
//   • throttle     — under N sent per throttle_window_seconds
//   • dailyCap     — under daily_cap sent today (campaign timezone)
// On drain: a recurring campaign re-enqueues from scratch (re-pulls the source,
// picking up new contacts/items); otherwise it completes.
// Benefits over the old in-process loop: pause works, scheduling works, and it's
// resumable (all state in Postgres).
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { getWorkspaceMessageRate } from '@/lib/pricing'
import { isWithinSendWindows, startOfLocalDayUTC } from '@/lib/scheduling'
import { resolveCampaignRecipients, hydrateTemplate } from '@/lib/campaign-recipients'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const DISPATCHED = ['sent', 'failed']

async function getOrCreateConversation(phone, fromNumber, workspaceId, createdBy) {
  const { data: existing } = await supabaseAdmin.from('conversations').select('*')
    .eq('phone_number', phone).eq('from_number', fromNumber).maybeSingle()
  if (existing) {
    if (!existing.workspace_id) await supabaseAdmin.from('conversations').update({ workspace_id: workspaceId }).eq('id', existing.id)
    return existing
  }
  const { data: created, error } = await supabaseAdmin.from('conversations')
    .insert({ phone_number: phone, from_number: fromNumber, workspace_id: workspaceId, created_by: createdBy }).select().single()
  if (error && error.code === '23505') {
    const { data: fb } = await supabaseAdmin.from('conversations').select('*').eq('phone_number', phone).eq('from_number', fromNumber).single()
    return fb
  }
  if (error) throw error
  return created
}

const CAMPAIGN_COLS = 'id, status, sender_number, message_template, workspace_id, created_by, delay_between_messages, scheduled_at, throttle_count, throttle_window_seconds, send_windows, send_timezone, send_days, daily_cap, recurring, cycle, contact_list_ids, recipient_filters'

export async function sweepSmsCampaignQueue({ batchSize = 50 } = {}) {
  const now = new Date()

  const { data: campaigns } = await supabaseAdmin.from('campaigns').select(CAMPAIGN_COLS).eq('status', 'running').limit(1000)
  if (!campaigns?.length) return { picked: 0, sent: 0, failed: 0, skipped: 0 }
  const byId = new Map(campaigns.map(c => [c.id, c]))
  const ids = campaigns.map(c => c.id)

  // Per-campaign gates, computed once.
  const startReached = new Map(), inWindow = new Map(), allowance = new Map(), dailyAllowance = new Map(), processed = new Map()
  for (const c of campaigns) {
    startReached.set(c.id, !c.scheduled_at || new Date(c.scheduled_at).getTime() <= now.getTime())
    inWindow.set(c.id, isWithinSendWindows(now, c.send_windows, c.send_timezone || 'America/New_York', c.send_days))

    if (c.throttle_count > 0) {
      const windowSec = c.throttle_window_seconds > 0 ? c.throttle_window_seconds : 3600
      const { count } = await supabaseAdmin.from('campaign_messages').select('id', { count: 'exact', head: true })
        .eq('campaign_id', c.id).in('status', DISPATCHED).gte('sent_at', new Date(Date.now() - windowSec * 1000).toISOString())
      allowance.set(c.id, Math.max(0, c.throttle_count - (count || 0)))
    } else allowance.set(c.id, Infinity)

    if (c.daily_cap > 0) {
      const dayStartIso = new Date(startOfLocalDayUTC(Date.now(), c.send_timezone || 'America/New_York')).toISOString()
      const { count } = await supabaseAdmin.from('campaign_messages').select('id', { count: 'exact', head: true })
        .eq('campaign_id', c.id).in('status', DISPATCHED).gte('sent_at', dayStartIso)
      dailyAllowance.set(c.id, Math.max(0, c.daily_cap - (count || 0)))
    } else dailyAllowance.set(c.id, Infinity)
  }

  const { data: rows } = await supabaseAdmin.from('campaign_messages').select('id, campaign_id, to_number, body')
    .eq('status', 'queued').in('campaign_id', ids).order('created_at', { ascending: true }).limit(batchSize)

  if (!rows?.length) {
    await finalizeOrRecur(campaigns)
    return { picked: 0, sent: 0, failed: 0, skipped: 0 }
  }

  let sent = 0, failed = 0, skipped = 0
  const rateCache = new Map()

  for (const row of rows) {
    const c = byId.get(row.campaign_id)
    if (!c || c.status !== 'running' || !row.to_number) { skipped++; continue }
    if (!startReached.get(c.id)) { skipped++; continue }          // scheduled start not reached
    if (!inWindow.get(c.id)) { skipped++; continue }              // outside send window / day
    const allow = Math.min(allowance.get(c.id) ?? Infinity, dailyAllowance.get(c.id) ?? Infinity)
    const used = processed.get(c.id) || 0
    if (used >= allow) { skipped++; continue }                    // throttle / daily cap reached
    processed.set(c.id, used + 1)

    const { data: claimed } = await supabaseAdmin.from('campaign_messages')
      .update({ status: 'sending', sent_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'queued').select('id').maybeSingle()
    if (!claimed) { skipped++; continue }

    try {
      const conv = await getOrCreateConversation(row.to_number, c.sender_number, c.workspace_id, c.created_by)
      const result = await telnyx.sendMessage(c.sender_number, row.to_number, row.body || '')
      if (result.success) {
        // The message is out the door — record it as sent first, then treat
        // billing and conversation bookkeeping as best-effort. A bookkeeping
        // failure must never flip a delivered message back to 'failed'.
        let msgId = null
        try {
          const { data: msg } = await supabaseAdmin.from('messages').insert({
            conversation_id: conv.id, telnyx_message_id: result.messageId, direction: 'outbound',
            from_number: c.sender_number, to_number: row.to_number, body: row.body, status: 'sent', sent_by: c.created_by,
          }).select('id').single()
          msgId = msg?.id
        } catch (e) {
          console.error('[sms-queue] message insert failed (send succeeded):', e.message)
        }
        await supabaseAdmin.from('campaign_messages').update({ status: 'sent', message_id: msgId, sent_at: new Date().toISOString() }).eq('id', row.id)
        sent++
        try {
          if (!rateCache.has(c.workspace_id)) rateCache.set(c.workspace_id, await getWorkspaceMessageRate(c.workspace_id))
          await supabaseAdmin.rpc('deduct_message_cost', {
            p_user_id: c.created_by, p_workspace_id: c.workspace_id, p_message_count: 1, p_cost_per_message: rateCache.get(c.workspace_id),
            p_description: `Campaign SMS to ${row.to_number}`, p_campaign_id: c.id, p_message_id: msgId, p_recipient_phone: row.to_number,
          })
          await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
        } catch (e) {
          console.error('[sms-queue] post-send bookkeeping failed (send succeeded):', e.message)
        }
      } else {
        await supabaseAdmin.from('campaign_messages').update({ status: 'failed', error_message: result.error }).eq('id', row.id); failed++
      }
    } catch (e) {
      await supabaseAdmin.from('campaign_messages').update({ status: 'failed', error_message: e.message }).eq('id', row.id); failed++
    }
    if (c.delay_between_messages > 0) await sleep(Math.min(c.delay_between_messages, 2000))
  }

  await updateCounts(ids)
  await finalizeOrRecur(campaigns)
  return { picked: rows.length, sent, failed, skipped }
}

async function updateCounts(ids) {
  for (const id of ids) {
    const { count: s } = await supabaseAdmin.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'sent')
    const { count: f } = await supabaseAdmin.from('campaign_messages').select('id', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'failed')
    await supabaseAdmin.from('campaigns').update({ sent_count: s || 0, failed_count: f || 0 }).eq('id', id)
  }
}

// On drain: recurring → re-pull the source and re-enqueue a fresh cycle;
// otherwise mark completed. Recurring without a daily cap / throttle would loop
// continuously, so we only recur when one is set (the UI enforces this too).
async function finalizeOrRecur(campaigns) {
  for (const c of campaigns) {
    const { count: remaining } = await supabaseAdmin.from('campaign_messages')
      .select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).in('status', ['queued', 'sending'])
    if ((remaining || 0) > 0) continue

    const hasCadence = (c.daily_cap > 0) || (c.throttle_count > 0)
    if (c.recurring && hasCadence) {
      try {
        const recipients = await resolveCampaignRecipients(c, c.workspace_id)
        await supabaseAdmin.from('campaign_messages').delete().eq('campaign_id', c.id)
        const rows = recipients.map(r => ({
          campaign_id: c.id, contact_id: r.key.contact_id || null, monday_item_id: r.key.monday_item_id || null,
          sheet_row_id: r.key.sheet_row_id || null,
          to_number: r.phone, body: hydrateTemplate(c.message_template, r.vars), status: 'queued',
        }))
        for (let i = 0; i < rows.length; i += 500) await supabaseAdmin.from('campaign_messages').insert(rows.slice(i, i + 500))
        await supabaseAdmin.from('campaigns').update({
          cycle: (c.cycle || 1) + 1, sent_count: 0, failed_count: 0, total_recipients: rows.length,
          status: rows.length ? 'running' : 'completed',
        }).eq('id', c.id)
        console.log(`[sms-queue] recurring campaign ${c.id} → cycle ${(c.cycle || 1) + 1}, ${rows.length} recipients`)
      } catch (e) {
        console.error('[sms-queue] recurring re-enqueue failed:', e.message)
      }
    } else {
      await supabaseAdmin.from('campaigns').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', c.id)
    }
  }
}
