// Workspace-level business hours.
//   GET — current settings for the user's workspace.
//   PUT — update them. Validates timezone + day numbers + time format.
//
// Reads/writes the business_hours_* columns added on the workspaces table.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('workspaces')
    .select('business_hours_enabled, business_hours_start, business_hours_end, business_hours_tz, business_days')
    .eq('id', user.workspaceId)
    .maybeSingle()

  if (error) {
    console.error('[business-hours GET] error:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
  return NextResponse.json({
    enabled: data?.business_hours_enabled ?? false,
    start:   data?.business_hours_start   ?? '09:00:00',
    end:     data?.business_hours_end     ?? '18:00:00',
    tz:      data?.business_hours_tz      ?? 'America/New_York',
    days:    data?.business_days          ?? [1, 2, 3, 4, 5],
  })
}

export async function PUT(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { enabled, start, end, tz, days } = body

  if (typeof enabled !== 'boolean') return NextResponse.json({ error: '`enabled` must be boolean' }, { status: 400 })
  if (!TIME_RE.test(String(start))) return NextResponse.json({ error: '`start` must be HH:MM' }, { status: 400 })
  if (!TIME_RE.test(String(end)))   return NextResponse.json({ error: '`end` must be HH:MM' }, { status: 400 })
  if (!isValidTz(tz))               return NextResponse.json({ error: '`tz` must be a valid IANA timezone' }, { status: 400 })
  if (!Array.isArray(days) || days.length === 0 || days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) {
    return NextResponse.json({ error: '`days` must be a non-empty array of 1–7' }, { status: 400 })
  }
  // Start must precede end — a wrap-around window (e.g. 22:00–06:00) is nuanced
  // and not worth supporting for v1; reject it explicitly.
  if (String(end) <= String(start)) {
    return NextResponse.json({ error: '`end` must be after `start`' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('workspaces')
    .update({
      business_hours_enabled: enabled,
      business_hours_start: start,
      business_hours_end: end,
      business_hours_tz: tz,
      business_days: days,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.workspaceId)

  if (error) {
    console.error('[business-hours PUT] error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
