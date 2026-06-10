// List + create voicemail campaigns for the current workspace.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('*')
    .eq('workspace_id', workspace.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[voicemail-campaigns:GET]', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaigns: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const {
    name, recordingUrl, recordingPath, voicedropRecordingUrl, senderNumber, contactListIds,
    phoneColumns, chunkSize, chunkIndex,
    // Optional throttle: send at most `throttleCount` every
    // `throttleWindowSeconds`. Omitted / 0 → no throttle (max speed).
    throttleCount, throttleWindowSeconds,
    // Optional calling windows: only send when local time falls in a window.
    // [{start:"10:00",end:"12:00"}, ...] + an IANA timezone. Empty → anytime.
    sendWindows, sendTimezone,
    // Optional weekday restriction (1=Mon..7=Sun) — mirrors workspace business
    // days for the "Business hours" option. Empty/omitted → any day.
    sendDays,
    // Optional contact statuses to skip (e.g. do_not_call). Stored so the
    // start-route rebuild path also honors the exclusion.
    excludeStatuses,
    // Optional monitor/canary numbers — receive the voicemail once per day while
    // running so you can confirm the drip fired. E.164, separate from the lists.
    monitorNumbers,
    // Optional per-day cap: at most this many voicemails per local day; the rest
    // roll to the next day. Omitted / 0 → no daily limit.
    dailyCap,
    // Optional one-time scheduled start (ISO). Holds the whole campaign until
    // this moment, then sends at-or-after it. Null → send now.
    startsAt,
    // Optional: an explicit recipient list from the wizard. When the user
    // searches/unticks specific rows on Step 3, we honor exactly that set
    // rather than recomputing the chunk slice server-side.
    explicitRecipients,
  } = body

  if (!name || !recordingUrl || !senderNumber || !Array.isArray(contactListIds) || contactListIds.length === 0) {
    return NextResponse.json(
      { error: 'name, recordingUrl, senderNumber, and at least one contactListId are required' },
      { status: 400 }
    )
  }

  // Normalize chunk + columns. Defaults preserve the legacy behavior:
  //   - phone_columns = ['phone_number']  (primary only)
  //   - chunk_size = 0, chunk_index = 0   (no chunking, send whole list)
  const normalizedColumns = Array.isArray(phoneColumns) && phoneColumns.length > 0
    ? phoneColumns.filter(c => typeof c === 'string' && c.trim().length > 0)
    : ['phone_number']
  const normalizedChunkSize = Number.isFinite(Number(chunkSize)) ? Math.max(0, Math.floor(Number(chunkSize))) : 0
  const normalizedChunkIndex = normalizedChunkSize > 0 && Number.isFinite(Number(chunkIndex))
    ? Math.max(0, Math.floor(Number(chunkIndex)))
    : 0

  // Throttle: null when unset / non-positive (= no throttle / max speed).
  // Window defaults to 1 hour; clamped to a sane minimum of 60s.
  const normalizedThrottle = Number.isFinite(Number(throttleCount)) && Number(throttleCount) > 0
    ? Math.floor(Number(throttleCount))
    : null
  const normalizedThrottleWindow = Number.isFinite(Number(throttleWindowSeconds)) && Number(throttleWindowSeconds) >= 60
    ? Math.floor(Number(throttleWindowSeconds))
    : 3600

  // Calling windows: keep only well-formed { start, end } "HH:MM" pairs.
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
  const normalizedWindows = Array.isArray(sendWindows)
    ? sendWindows.filter(w => w && HHMM.test(w.start) && HHMM.test(w.end) && w.end > w.start)
                 .map(w => ({ start: w.start, end: w.end }))
    : null
  const normalizedTimezone = typeof sendTimezone === 'string' && sendTimezone.trim()
    ? sendTimezone.trim()
    : 'America/New_York'

  // Daily cap: positive int, else null (no limit).
  const normalizedDailyCap = Number.isFinite(Number(dailyCap)) && Number(dailyCap) > 0
    ? Math.floor(Number(dailyCap))
    : null

  // Send days: unique ISO weekday numbers 1..7, else null (any day).
  const normalizedSendDays = Array.isArray(sendDays)
    ? (() => {
        const set = [...new Set(sendDays.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
        return set.length > 0 && set.length < 7 ? set : null   // all 7 == no restriction
      })()
    : null

  // Excluded statuses: clean string slugs, else null.
  const normalizedExcludeStatuses = Array.isArray(excludeStatuses)
    ? (() => {
        const set = [...new Set(excludeStatuses.filter(s => typeof s === 'string' && s.trim()))]
        return set.length > 0 ? set : null
      })()
    : null

  // Monitor numbers → E.164, deduped, capped at 10. Drops anything unparseable.
  const toE164 = (raw) => {
    const d = String(raw || '').replace(/\D/g, '')
    if (d.length === 10) return `+1${d}`
    if (d.length === 11 && d.startsWith('1')) return `+${d}`
    if (d.length >= 11) return `+${d}`
    return null
  }
  const normalizedMonitorNumbers = Array.isArray(monitorNumbers)
    ? (() => {
        const set = [...new Set(monitorNumbers.map(toE164).filter(Boolean))].slice(0, 10)
        return set.length > 0 ? set : null
      })()
    : null

  // Scheduled start: accept a valid future ISO; past/invalid → null (send now).
  let normalizedStartsAt = null
  if (startsAt) {
    const t = new Date(startsAt)
    if (!isNaN(t.getTime()) && t.getTime() > Date.now()) normalizedStartsAt = t.toISOString()
  }

  // Sender number must belong to this workspace AND be voicedrop_verified
  const { data: pn } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, voicedrop_verified')
    .eq('phone_number', senderNumber)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()

  if (!pn) {
    return NextResponse.json({ error: 'Sender number not found in this workspace' }, { status: 400 })
  }
  if (!pn.voicedrop_verified) {
    return NextResponse.json({ error: 'Sender number is not yet verified for voicemail' }, { status: 400 })
  }

  const { data: campaign, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .insert({
      workspace_id: workspace.workspaceId,
      created_by: user.userId,
      name,
      recording_url: recordingUrl,
      recording_path: recordingPath || null,
      voicedrop_recording_url: voicedropRecordingUrl || null,
      sender_number: senderNumber,
      contact_list_ids: contactListIds,
      phone_columns: normalizedColumns,
      chunk_size: normalizedChunkSize,
      chunk_index: normalizedChunkIndex,
      throttle_count: normalizedThrottle,
      throttle_window_seconds: normalizedThrottleWindow,
      send_windows: (normalizedWindows && normalizedWindows.length > 0) ? normalizedWindows : null,
      send_timezone: normalizedTimezone,
      send_days: normalizedSendDays,
      exclude_statuses: normalizedExcludeStatuses,
      monitor_numbers: normalizedMonitorNumbers,
      daily_cap: normalizedDailyCap,
      starts_at: normalizedStartsAt,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('[voicemail-campaigns:POST]', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }

  // If the wizard supplied an explicit recipient list (after the user picked
  // a chunk + searched + unticked rows), pre-populate the queue here. The
  // /start route will then see existing rows and skip the contact-list rebuild.
  if (Array.isArray(explicitRecipients) && explicitRecipients.length > 0) {
    const queueRows = explicitRecipients
      .filter(r => r && typeof r.phone === 'string' && r.phone.length >= 7)
      .map(r => ({
        campaign_id: campaign.id,
        workspace_id: workspace.workspaceId,
        contact_id: r.contactId || null,
        phone: r.phone,
        source_column: r.sourceColumn || 'phone_number',
        status: 'queued',
      }))
    // Insert in 1000-row batches (a 15k-row upsert can exceed request limits).
    for (let i = 0; i < queueRows.length; i += 1000) {
      const { error: enqErr } = await supabaseAdmin
        .from('voicemail_campaign_sends')
        .upsert(queueRows.slice(i, i + 1000), { onConflict: 'campaign_id,phone', ignoreDuplicates: true })
      if (enqErr) {
        console.error('[voicemail-campaigns:POST] explicit enqueue failed:', enqErr)
        // Don't fail the create — /start can still fall back to the list rebuild.
        break
      }
    }
  }

  return NextResponse.json({ success: true, campaign })
}
