// Per-recipient breakdown for an RVM campaign — used by the details modal to
// show each number, its delivery status, the time it was sent/delivered, and
// (for still-queued numbers) an ESTIMATED send time based on the campaign's
// throttle + calling windows.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import { estimateSendSchedule, startOfLocalDayUTC } from '@/lib/scheduling'

export async function GET(request, { params }) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: campaignId } = await params

  const { data, error } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('phone, status, sent_at, delivered_at, error, created_at')
    .eq('campaign_id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .order('sent_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(5000)

  if (error) {
    console.error('[rvm:recipients]', error)
    return NextResponse.json({ error: 'Failed to load recipients' }, { status: 500 })
  }

  const recipients = data || []

  // Load the campaign's pacing config so we can estimate when each still-queued
  // recipient will actually send.
  const { data: campaign } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('throttle_count, throttle_window_seconds, send_windows, send_timezone, status, starts_at, daily_cap')
    .eq('id', campaignId)
    .maybeSingle()

  const tz = campaign?.send_timezone || 'America/New_York'
  const throttleCount = campaign?.throttle_count && campaign.throttle_count > 0 ? campaign.throttle_count : 0
  const windowSec = campaign?.throttle_window_seconds || 3600
  const windows = Array.isArray(campaign?.send_windows) ? campaign.send_windows : null
  const dailyCap = campaign?.daily_cap && campaign.daily_cap > 0 ? campaign.daily_cap : 0

  // Precisely schedule the still-queued rows (in dispatch order) so each shows
  // an accurate "will send at". Recomputed every poll from `now`, so as rows
  // send the remaining estimates shift earlier — realtime as statuses change.
  if (campaign?.status === 'running' || campaign?.status === 'paused' || campaign?.status === 'draft') {
    const pending = recipients.filter(r => r.status === 'queued' || r.status === 'sending')
    // Schedule from the later of "now" and the campaign's start time.
    const startMs = campaign?.starts_at ? new Date(campaign.starts_at).getTime() : 0
    const fromMs = Math.max(Date.now(), startMs)
    const schedule = estimateSendSchedule(pending.length, fromMs, throttleCount, windowSec, windows, tz, dailyCap)
    pending.forEach((r, i) => { r.estimated_at = schedule[i] })
  }

  // Accurate, UNCAPPED summary counts for the progress bar — the recipients
  // list above is capped at 5,000 rows, so for big campaigns we must count
  // server-side rather than trust the (possibly truncated) array length.
  const DISPATCHED = ['sent', 'delivered', 'failed']
  const [
    { count: total },
    { count: dispatched },
    { count: deliveredCount },
    { count: failedCount },
  ] = await Promise.all([
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('workspace_id', workspace.workspaceId),
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('workspace_id', workspace.workspaceId).in('status', DISPATCHED),
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('workspace_id', workspace.workspaceId).eq('status', 'delivered'),
    supabaseAdmin.from('voicemail_campaign_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('workspace_id', workspace.workspaceId).eq('status', 'failed'),
  ])

  // For a daily-capped campaign, how many already went out TODAY (campaign tz).
  let sentToday = 0
  if (dailyCap > 0) {
    const dayStartIso = new Date(startOfLocalDayUTC(Date.now(), tz)).toISOString()
    const { count } = await supabaseAdmin
      .from('voicemail_campaign_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .in('status', DISPATCHED)
      .gte('sent_at', dayStartIso)
    sentToday = count || 0
  }

  return NextResponse.json({
    success: true,
    recipients,
    timezone: tz,
    summary: {
      total: total || 0,
      dispatched: dispatched || 0,
      delivered: deliveredCount || 0,
      failed: failedCount || 0,
      sentToday,
      dailyCap,
    },
  })
}
