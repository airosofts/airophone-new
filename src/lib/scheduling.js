// Schedule helper for delayed sends and business-hours-aware processing.
// Used by:
//   - the Monday webhook (when an event fires, compute "when should we text?")
//   - the sweeper (when a 'scheduled' row's time arrives, "is now still ok?")
//
// All times stored in the DB are UTC timestamptz. Business hours are
// configured in the workspace's IANA timezone — we convert into that zone
// to decide whether `at` falls inside the window.

// Convert a UTC Date into the wall-clock equivalent for the given IANA zone.
// Returns { weekday (1=Mon..7=Sun), hours, minutes }.
function toLocal(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const m = (k) => parts.find(p => p.type === k)?.value
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[m('weekday')] || 1
  // Intl can emit '24' for midnight — clamp.
  const hours = Number(m('hour')) % 24
  const minutes = Number(m('minute'))
  return { weekday: wd, hours, minutes }
}

function parseHHMM(s) {
  const [h, m] = String(s || '00:00').split(':').map((x) => Number(x))
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 }
}

// Is `at` inside the workspace's business hours window?
// Note: there's no workspace-level on/off — the opt-in lives on the automation.
// Callers gate on `automation.respect_business_hours` before invoking this.
export function isInBusinessHours(at, hours) {
  if (!hours) return true   // workspace row missing — fail open
  const tz = hours.business_hours_tz || 'UTC'
  const local = toLocal(at, tz)
  const days = hours.business_days || [1, 2, 3, 4, 5]
  if (!days.includes(local.weekday)) return false
  const start = parseHHMM(hours.business_hours_start)
  const end   = parseHHMM(hours.business_hours_end)
  const nowMin   = local.hours * 60 + local.minutes
  const startMin = start.h * 60 + start.m
  const endMin   = end.h * 60 + end.m
  return nowMin >= startMin && nowMin < endMin
}

// If `at` is outside business hours, return the next moment that is.
// Walks forward in 15-minute steps for at most 8 days; falls back to `at`
// if no window is found (e.g. business_days is empty — shouldn't happen).
export function nextBusinessTime(at, hours) {
  if (!hours) return at   // workspace row missing — fall through without snapping
  if (isInBusinessHours(at, hours)) return at
  const start = parseHHMM(hours.business_hours_start)
  const tz = hours.business_hours_tz || 'UTC'
  // Search day-by-day, snapping to start-of-window in the workspace zone.
  for (let i = 0; i < 8; i++) {
    const probe = new Date(at.getTime() + i * 24 * 60 * 60 * 1000)
    const local = toLocal(probe, tz)
    const days = hours.business_days || [1, 2, 3, 4, 5]
    if (!days.includes(local.weekday)) continue
    // Day is valid — snap to its start time. Build a Date for that wall-clock
    // moment in the target zone by binary-searching minute offsets within the
    // day. Simpler: use the UTC offset implied by the zone at the start of the
    // probe day. We rebuild the UTC instant from the wall-clock target.
    const target = wallTimeToUTC(probe, tz, start.h, start.m)
    if (target.getTime() > at.getTime()) return target
    // If the target is in the past today (i.e. window already over), the
    // next iteration walks to the following day.
  }
  return at
}

// Is `at` inside one of the campaign's calling windows? `windows` is an array
// of { start: "HH:MM", end: "HH:MM" } in the given IANA timezone. Empty/missing
// windows → always true (send anytime). Used by the RVM queue sweeper to gate
// sends to good calling hours.
export function isWithinSendWindows(at, windows, tz = 'America/New_York') {
  if (!Array.isArray(windows) || windows.length === 0) return true
  const local = toLocal(at, tz)
  const nowMin = local.hours * 60 + local.minutes
  for (const w of windows) {
    const s = parseHHMM(w?.start)
    const e = parseHHMM(w?.end)
    const startMin = s.h * 60 + s.m
    const endMin = e.h * 60 + e.m
    if (endMin > startMin && nowMin >= startMin && nowMin < endMin) return true
  }
  return false
}

// Given `at`, return the next moment a send is allowed under `windows` (in tz).
// Inside a window → `at` unchanged. Otherwise the next window-start (searching
// up to 8 days). Empty windows → `at` (anytime). Used to estimate when a queued
// recipient will actually go out.
export function nextSendTime(at, windows, tz = 'America/New_York') {
  if (!Array.isArray(windows) || windows.length === 0) return at
  if (isWithinSendWindows(at, windows, tz)) return at
  const starts = windows.map(w => { const s = parseHHMM(w?.start); return s.h * 60 + s.m })
    .sort((a, b) => a - b)
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const probe = new Date(at.getTime() + dayOffset * 86400000)
    const local = toLocal(probe, tz)
    const nowMin = dayOffset === 0 ? local.hours * 60 + local.minutes : -1
    for (const startMin of starts) {
      if (dayOffset === 0 && startMin <= nowMin) continue
      const target = wallTimeToUTC(probe, tz, Math.floor(startMin / 60), startMin % 60)
      if (target.getTime() > at.getTime()) return target
    }
  }
  return at
}

// The UTC instant of local midnight (start of the day) for `ms` in `tz`.
// Used by the sweeper to count "how many already went out today" for the daily
// cap, and by the estimator to detect day rollovers. Minute-granularity
// (offsets for supported zones are whole minutes), which is plenty here.
export function startOfLocalDayUTC(ms, tz = 'America/New_York') {
  const local = toLocal(new Date(ms), tz)
  const minsFromMidnight = local.hours * 60 + local.minutes
  // Drop to the top of the current minute, then back off to local midnight.
  const topOfMinute = ms - (ms % 60000)
  return topOfMinute - minsFromMidnight * 60000
}

// 'YYYY-MM-DD' for `ms` in `tz` — a stable key to tell which local day a send
// falls on (so the estimator can reset its per-day counter at midnight).
function localDayKey(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))
}

// Precisely simulate when each of `count` queued sends will go out, given the
// throttle (N every W seconds, as batches), calling windows, AND an optional
// per-day cap. Models window CAPACITY (a window fits floor(windowLen / W)
// batches; once full, the rest spill forward) and the daily cap (once `dailyCap`
// sends land in one local day, the rest roll to the next local day). Returns an
// array of ISO timestamps (one per send, in dispatch order). Used to show an
// accurate "will send at" per recipient and to project completion.
//
//   throttleCount = 0 / falsy → no throttle (all fire at the first allowed time)
//   windows = null / []       → anytime (no window snapping)
//   dailyCap = 0 / falsy      → no per-day limit
export function estimateSendSchedule(count, fromMs, throttleCount, throttleWindowSec, windows, tz = 'America/New_York', dailyCap = 0) {
  const out = []
  const N = throttleCount && throttleCount > 0 ? throttleCount : Infinity
  const W = (throttleWindowSec && throttleWindowSec > 0 ? throttleWindowSec : 0) * 1000
  const DCAP = dailyCap && dailyCap > 0 ? dailyCap : Infinity

  let cursor = nextSendTime(new Date(fromMs), windows, tz).getTime()
  let batchStart = cursor
  let inBatch = 0
  let dayKey = localDayKey(cursor, tz)
  let dayCount = 0
  let guard = 0

  for (let i = 0; i < count; i++) {
    if (inBatch >= N) {
      // One throttle period elapsed → next batch. Snap into a window; if that
      // pushes past the current window's end, it lands in the next window.
      cursor = nextSendTime(new Date(batchStart + W), windows, tz).getTime()
      batchStart = cursor
      inBatch = 0
    } else {
      // Keep the batch inside a window (no-op when already inside).
      cursor = nextSendTime(new Date(cursor), windows, tz).getTime()
    }

    // Day rollover (the cursor may have advanced past midnight) → reset count.
    let k = localDayKey(cursor, tz)
    if (k !== dayKey) { dayKey = k; dayCount = 0 }

    // Daily cap reached → jump to the start of the next local day and resnap.
    if (dayCount >= DCAP && guard < count * 2 + 32) {
      guard++
      const nextMidnight = startOfLocalDayUTC(cursor, tz) + 24 * 60 * 60 * 1000
      cursor = nextSendTime(new Date(nextMidnight), windows, tz).getTime()
      batchStart = cursor
      inBatch = 0
      dayKey = localDayKey(cursor, tz)
      dayCount = 0
    }

    out.push(new Date(cursor).toISOString())
    inBatch++
    dayCount++
  }
  return out
}

// If `at` is INSIDE business hours, return the next moment OUTSIDE them — i.e.
// the end of the current window. If already outside, return `at` unchanged.
// Used by the "only outside business hours" automation mode.
export function nextOutsideBusinessTime(at, hours) {
  if (!hours) return at
  if (!isInBusinessHours(at, hours)) return at   // already outside — fine to send
  // We're inside [start, end). Jump to the window's end time today; at exactly
  // `end`, isInBusinessHours is false (the window is half-open), so it's valid.
  const end = parseHHMM(hours.business_hours_end)
  const tz = hours.business_hours_tz || 'UTC'
  const target = wallTimeToUTC(at, tz, end.h, end.m)
  return target.getTime() > at.getTime() ? target : at
}

// Given a probe Date (any time on a particular day in the target zone),
// produce the UTC Date representing `targetH:targetM` on that same day in the
// target zone. Uses a one-shot offset lookup — works across DST boundaries
// because we ask Intl what the zone says about the probe moment.
function wallTimeToUTC(probe, tz, targetH, targetM) {
  // Get the zone's wall-clock for the probe.
  const local = toLocal(probe, tz)
  // Difference in minutes between probe and the target moment, in the zone.
  const deltaMin = (targetH * 60 + targetM) - (local.hours * 60 + local.minutes)
  return new Date(probe.getTime() + deltaMin * 60 * 1000)
}

// Resolve an automation's business-hours mode. Prefers the new
// `business_hours_mode` ('anytime' | 'within' | 'outside'); falls back to the
// legacy boolean `respect_business_hours` so old rows keep working.
export function businessHoursMode(automation) {
  if (automation?.business_hours_mode) return automation.business_hours_mode
  return automation?.respect_business_hours ? 'within' : 'anytime'
}

// The "when should this send fire?" decision. Returns a Date.
//   1. Start from now + send_delay_seconds.
//   2. Snap to the window the automation's business-hours mode requires:
//      'within'  → next moment inside business hours
//      'outside' → next moment outside business hours
//      'anytime' → no snapping
export function computeScheduledAt(automation, workspaceHours, now = new Date()) {
  const baseDelayMs = Math.max(0, Number(automation.send_delay_seconds || 0)) * 1000
  const base = new Date(now.getTime() + baseDelayMs)
  const mode = businessHoursMode(automation)
  if (mode === 'within') return nextBusinessTime(base, workspaceHours)
  if (mode === 'outside') return nextOutsideBusinessTime(base, workspaceHours)
  return base
}
