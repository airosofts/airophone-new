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

// The "when should this send fire?" decision. Returns a Date.
//   1. Start from now + send_delay_seconds.
//   2. If business hours are enabled AND the automation opts in, snap forward
//      to the next valid window.
export function computeScheduledAt(automation, workspaceHours, now = new Date()) {
  const baseDelayMs = Math.max(0, Number(automation.send_delay_seconds || 0)) * 1000
  const base = new Date(now.getTime() + baseDelayMs)
  if (!automation.respect_business_hours) return base
  return nextBusinessTime(base, workspaceHours)
}
