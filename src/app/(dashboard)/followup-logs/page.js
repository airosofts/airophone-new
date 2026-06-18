'use client'

// Follow-Up Logs — one row per (lead, follow-up stage): scheduled vs actual
// send time + a status. Reads /api/followups/logs.

import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '@/lib/api-client'

const STATUS_STYLES = {
  scheduled:         { label: 'Scheduled',             cls: 'bg-[#EEF2FF] text-[#3730A3] border-[#C7D2FE]' },
  sent:              { label: 'Sent',                  cls: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]' },
  delivered:         { label: 'Delivered',             cls: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]' },
  failed:            { label: 'Failed',                cls: 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]' },
  responded_before:  { label: 'Responded Before',      cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]' },
  cancelled:         { label: 'Cancelled',             cls: 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]' },
  skipped:           { label: 'Skipped',               cls: 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]' },
}

const FILTERS = [
  { v: '', l: 'All' },
  { v: 'scheduled', l: 'Scheduled' },
  { v: 'sent', l: 'Sent' },
  { v: 'delivered', l: 'Delivered' },
  { v: 'failed', l: 'Failed' },
  { v: 'responded_before', l: 'Responded' },
  { v: 'skipped', l: 'Skipped' },
]

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function FollowUpLogsPage() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(`/api/followups/logs?page=${page}&status=${status}`)
      const data = await res.json()
      setRows(data?.rows || [])
      setTotal(data?.total || 0)
    } catch { setRows([]); setTotal(0) }
    finally { setLoading(false) }
  }, [page, status])

  useEffect(() => { load() }, [load])

  const Badge = ({ s }) => {
    const cfg = STATUS_STYLES[s] || STATUS_STYLES.scheduled
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.cls}`}>{cfg.label}</span>
  }

  const pages = Math.ceil(total / pageSize)

  return (
    <div className="h-full bg-[#F7F6F3] overflow-y-auto">
      <div className="px-6 py-8 max-w-6xl">
        <h1 className="text-xl font-semibold text-[#131210]">Follow-up Logs</h1>
        <p className="text-sm text-[#9B9890] mt-1 mb-5">Every follow-up that was scheduled, sent, or cancelled — across all leads.</p>

        <div className="flex items-center gap-1.5 mb-4">
          {FILTERS.map(f => (
            <button key={f.v} onClick={() => { setStatus(f.v); setPage(0) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${status === f.v ? 'bg-[#131210] text-white border-[#131210]' : 'bg-white text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F0EFEB]'}`}>
              {f.l}
            </button>
          ))}
        </div>

        <div className="bg-white border border-[#E3E1DB] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-[#9B9890] border-b border-[#EFEDE8]">
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Scenario</th>
                  <th className="px-4 py-3 font-medium">Template sent</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-[#9B9890]"><i className="fas fa-spinner fa-spin" /></td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-[#9B9890]">No follow-up activity yet.</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} className="border-b border-[#F4F2EE] last:border-0 hover:bg-[#FAFAF8]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#131210]">{r.lead_name || 'Unknown'}</div>
                      <div className="text-[11px] text-[#9B9890] font-mono">{r.phone || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-[#5C5A55]">{r.scenario_name || '—'}</td>
                    <td className="px-4 py-3 text-[#5C5A55] whitespace-nowrap">{fmt(r.template_sent_at)}</td>
                    <td className="px-4 py-3 text-[#5C5A55]">#{r.stage_number}</td>
                    <td className="px-4 py-3 text-[#5C5A55] whitespace-nowrap">{fmt(r.scheduled_for)}</td>
                    <td className="px-4 py-3 text-[#5C5A55] whitespace-nowrap">{fmt(r.sent_at)}</td>
                    <td className="px-4 py-3"><Badge s={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm text-[#5C5A55]">
            <span>{total} rows</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-[#E3E1DB] bg-white disabled:opacity-40">Prev</button>
              <span>Page {page + 1} / {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-[#E3E1DB] bg-white disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
