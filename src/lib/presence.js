// Presence = "active on the site recently". A client heartbeat stamps
// users.last_seen every ~45s; someone is considered ONLINE if their last_seen
// falls within this window (> the heartbeat interval, so a single skipped beat
// doesn't flap them offline).
export const PRESENCE_WINDOW_MS = 2 * 60 * 1000   // 2 minutes

export function isOnline(lastSeen) {
  if (!lastSeen) return false
  const t = new Date(lastSeen).getTime()
  return Number.isFinite(t) && (Date.now() - t) < PRESENCE_WINDOW_MS
}
