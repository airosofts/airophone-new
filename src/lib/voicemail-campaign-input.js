// Shared normalization + validation for RVM (voicemail) campaign create/update.
//
// Both POST /api/voicemail-campaigns (create draft) and
// PUT  /api/voicemail-campaigns/[id] (edit draft) accept the SAME wizard payload
// and must map it to the SAME DB columns — so the rules live here once. Returns
// either { error } or { columns, explicitRecipients }, where `columns` is the
// exact voicemail_campaigns column set (minus workspace_id/created_by/status).

export function normalizeVoicemailCampaignInput(body = {}) {
  const {
    name, recordingUrl, recordingPath, voicedropRecordingUrl, senderNumber, contactListIds,
    phoneColumns, chunkSize, chunkIndex,
    throttleCount, throttleWindowSeconds,
    sendWindows, sendTimezone, sendDays,
    excludeStatuses, monitorNumbers, dailyCap, startsAt,
    explicitRecipients,
  } = body

  if (!name || !recordingUrl || !senderNumber || !Array.isArray(contactListIds) || contactListIds.length === 0) {
    return { error: 'name, recordingUrl, senderNumber, and at least one contactListId are required' }
  }

  // phone columns / chunk — defaults preserve legacy behavior.
  const normalizedColumns = Array.isArray(phoneColumns) && phoneColumns.length > 0
    ? phoneColumns.filter(c => typeof c === 'string' && c.trim().length > 0)
    : ['phone_number']
  const normalizedChunkSize = Number.isFinite(Number(chunkSize)) ? Math.max(0, Math.floor(Number(chunkSize))) : 0
  const normalizedChunkIndex = normalizedChunkSize > 0 && Number.isFinite(Number(chunkIndex))
    ? Math.max(0, Math.floor(Number(chunkIndex)))
    : 0

  // Throttle: null when unset/non-positive (max speed); window ≥ 60s, default 1h.
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

  const normalizedDailyCap = Number.isFinite(Number(dailyCap)) && Number(dailyCap) > 0
    ? Math.floor(Number(dailyCap))
    : null

  const normalizedSendDays = Array.isArray(sendDays)
    ? (() => {
        const set = [...new Set(sendDays.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
        return set.length > 0 && set.length < 7 ? set : null   // all 7 == no restriction
      })()
    : null

  const normalizedExcludeStatuses = Array.isArray(excludeStatuses)
    ? (() => {
        const set = [...new Set(excludeStatuses.filter(s => typeof s === 'string' && s.trim()))]
        return set.length > 0 ? set : null
      })()
    : null

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

  return {
    columns: {
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
    },
    explicitRecipients: Array.isArray(explicitRecipients) ? explicitRecipients : [],
  }
}

// Map a wizard explicitRecipients array to voicemail_campaign_sends rows.
export function buildQueueRows(explicitRecipients, campaignId, workspaceId) {
  return (Array.isArray(explicitRecipients) ? explicitRecipients : [])
    .filter(r => r && typeof r.phone === 'string' && r.phone.length >= 7)
    .map(r => ({
      campaign_id: campaignId,
      workspace_id: workspaceId,
      contact_id: r.contactId || null,
      phone: r.phone,
      source_column: r.sourceColumn || 'phone_number',
      status: 'queued',
    }))
}
