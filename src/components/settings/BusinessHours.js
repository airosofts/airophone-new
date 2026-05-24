'use client'

// Workspace-level business hours. Backs the same columns used by the Monday
// automation sweeper (and any future feature that wants to respect them).

import { useState, useEffect } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'

// Common IANA timezones — keep the list short to avoid a 600-entry dropdown.
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'America/Toronto',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
]

const DAY_LABELS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
]

// Trim the seconds component off a Postgres time string ('09:00:00' → '09:00').
const trimSecs = (t) => String(t || '').slice(0, 5)

export default function BusinessHours() {
  const [start, setStart]     = useState('09:00')
  const [end, setEnd]         = useState('18:00')
  const [tz, setTz]           = useState('America/New_York')
  const [days, setDays]       = useState([1, 2, 3, 4, 5])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithWorkspace('/api/workspace/business-hours')
        const data = await res.json()
        if (res.ok) {
          setStart(trimSecs(data.start))
          setEnd(trimSecs(data.end))
          setTz(data.tz || 'America/New_York')
          setDays(Array.isArray(data.days) && data.days.length ? data.days : [1, 2, 3, 4, 5])
        }
      } catch (e) {
        console.error('[business-hours] load failed:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const toggleDay = (n) => {
    setDays(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n].sort((a, b) => a - b))
  }

  const save = async () => {
    setError('')
    if (end <= start) { setError('End time must be after start time.'); return }
    if (days.length === 0) { setError('Pick at least one day.'); return }
    setSaving(true)
    try {
      const res = await fetchWithWorkspace('/api/workspace/business-hours', {
        method: 'PUT',
        body: JSON.stringify({ start, end, tz, days }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-[#9B9890]">Loading…</p>

  return (
    <div>
      <h2 className="text-xl font-semibold text-[#131210]">Business hours</h2>
      <p className="text-sm text-[#9B9890] mt-1 mb-6">
        Defines the window automations use when they opt in. Per-automation toggle lives in the integration settings.
      </p>

      <div className="space-y-5 max-w-xl">
        <fieldset>
          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Start</label>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">End</label>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
              />
            </div>
          </div>

          {/* Timezone */}
          <div className="mt-4">
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Timezone</label>
            <select
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
            >
              {TIMEZONES.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>

          {/* Days */}
          <div className="mt-4">
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Active days</label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map(({ n, label }) => {
                const on = days.includes(n)
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleDay(n)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      on
                        ? 'border-[#D63B1F] bg-[rgba(214,59,31,0.08)] text-[#D63B1F]'
                        : 'border-[#E3E1DB] bg-white text-[#9B9890] hover:text-[#5C5A55]'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </fieldset>

        {error && <p className="text-sm text-[#D63B1F]">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="text-xs text-[#1F8C4A]">Saved.</span>}
        </div>
      </div>
    </div>
  )
}
