'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '@/lib/api-client'

export default function CallHistoryPage() {
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 50

  const fetchCalls = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(`/api/call-history?filter=${filter}&page=${page}&limit=${limit}`)
      const data = await res.json()
      if (data.success) {
        setCalls(data.calls)
        setTotal(data.total)
      }
    } catch (e) {
      console.error('Error fetching call history:', e)
    } finally {
      setLoading(false)
    }
  }, [filter, page])

  useEffect(() => {
    fetchCalls()
  }, [fetchCalls])

  const formatPhoneNumber = (phone) => {
    if (!phone) return '—'
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '—'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const formatCredits = (seconds) => {
    if (!seconds) return null
    const credits = seconds / 60 // 1 credit per minute
    return Math.round(credits) || 1 // minimum 1 credit display
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()

    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

    if (isToday) return `Today ${time}`
    if (isYesterday) return `Yesterday ${time}`
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
  }

  const getStatusBadge = (call) => {
    if (call.forwarded_to) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(214,59,31,0.07)] text-[#D63B1F]">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          Forwarded
        </span>
      )
    }
    switch (call.status) {
      case 'completed':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">Completed</span>
      case 'answered':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">Answered</span>
      case 'initiated':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-50 text-yellow-700">Ringing</span>
      case 'forwarded':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(214,59,31,0.07)] text-[#D63B1F]">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            Forwarded
          </span>
        )
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#F7F6F3] text-[#5C5A55]">{call.status || 'Unknown'}</span>
    }
  }

  const getDirectionIcon = (call) => {
    const isInbound = call.direction === 'incoming' || call.direction === 'inbound'
    const isMissed = call.status === 'missed'
    const isForwarded = call.status === 'forwarded' || call.forwarded_to

    if (isForwarded) {
      return (
        <div className="w-7 h-7 rounded-full bg-[rgba(214,59,31,0.07)] flex items-center justify-center flex-shrink-0" title="Forwarded">
          <svg className="w-3.5 h-3.5 text-[#D63B1F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" />
          </svg>
        </div>
      )
    }
    if (isMissed) {
      return (
        <div className="w-7 h-7 rounded-full bg-[rgba(214,59,31,0.07)] flex items-center justify-center flex-shrink-0" title="Missed">
          <svg className="w-3.5 h-3.5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3" />
            <line x1="15" y1="3" x2="21" y2="9" /><line x1="21" y1="3" x2="15" y2="9" />
          </svg>
        </div>
      )
    }
    if (isInbound) {
      return (
        <div className="w-7 h-7 rounded-full bg-[rgba(214,59,31,0.07)] flex items-center justify-center flex-shrink-0" title="Incoming">
          <svg className="w-3.5 h-3.5 text-[#D63B1F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 2 16 8 22 8" /><line x1="23" y1="1" x2="16" y2="8" />
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
          </svg>
        </div>
      )
    }
    return (
      <div className="w-7 h-7 rounded-full bg-[#D63B1F]/10 flex items-center justify-center flex-shrink-0" title="Outgoing">
        <svg className="w-3.5 h-3.5 text-[#D63B1F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 8 22 2 16 2" /><line x1="15" y1="9" x2="22" y2="2" />
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
        </svg>
      </div>
    )
  }

  const totalPages = Math.ceil(total / limit)
  const forwardedCount = calls.filter(c => c.forwarded_to || c.status === 'forwarded').length

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Header */}
      <div className="bg-[#FFFFFF] border-b border-[#E3E1DB] px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#131210]">Call History</h1>
            <p className="text-sm text-[#9B9890] mt-0.5">
              {total} total call{total !== 1 ? 's' : ''}
              {filter === 'all' && forwardedCount > 0 && (
                <span className="text-[#D63B1F] ml-2">({forwardedCount} forwarded on this page)</span>
              )}
            </p>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-[#EFEDE8] rounded-lg p-0.5">
            <button
              onClick={() => { setFilter('all'); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'all' ? 'bg-[#FFFFFF] text-[#131210] shadow-sm' : 'text-[#9B9890] hover:text-[#5C5A55]'
              }`}
            >
              All Calls
            </button>
            <button
              onClick={() => { setFilter('forwarded'); setPage(1) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === 'forwarded' ? 'bg-[#FFFFFF] text-[#131210] shadow-sm' : 'text-[#9B9890] hover:text-[#5C5A55]'
              }`}
            >
              Forwarded
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
          {loading ? (
            <div className="p-8 space-y-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 animate-pulse">
                  <div className="w-7 h-7 bg-[#EFEDE8] rounded-full" />
                  <div className="h-4 bg-[#EFEDE8] rounded w-32" />
                  <div className="h-4 bg-[#EFEDE8] rounded w-28" />
                  <div className="h-4 bg-[#EFEDE8] rounded w-20" />
                  <div className="h-4 bg-[#EFEDE8] rounded w-16" />
                </div>
              ))}
            </div>
          ) : calls.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-14 h-14 bg-[#EFEDE8] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-[#9B9890]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-[#5C5A55]">
                {filter === 'forwarded' ? 'No forwarded calls yet' : 'No call history yet'}
              </p>
              <p className="text-xs text-[#9B9890] mt-1">
                {filter === 'forwarded'
                  ? 'Forwarded calls will appear here once you set up call forwarding rules'
                  : 'Calls will appear here once you start making or receiving calls'}
              </p>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="grid grid-cols-[auto_1fr_1fr_1fr_100px_80px] gap-4 px-5 py-2.5 border-b border-[#E3E1DB] bg-[#F7F6F3]/50">
                <span className="w-7" />
                <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">From</span>
                <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">To</span>
                <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">
                  {filter === 'forwarded' ? 'Forwarded To' : 'Status'}
                </span>
                <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">Duration</span>
                <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">Time</span>
              </div>

              {/* Rows */}
              {calls.map((call) => (
                <div
                  key={call.id}
                  className="grid grid-cols-[auto_1fr_1fr_1fr_100px_80px] gap-4 items-center px-5 py-3 border-b border-[#EFEDE8] last:border-0 hover:bg-[#F7F6F3] transition-colors"
                >
                  {getDirectionIcon(call)}

                  <div>
                    <p className="text-sm text-[#131210] font-medium">{formatPhoneNumber(call.from_number)}</p>
                  </div>

                  <div>
                    <p className="text-sm text-[#5C5A55]">{formatPhoneNumber(call.to_number)}</p>
                  </div>

                  <div>
                    {filter === 'forwarded' || call.forwarded_to ? (
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-[#D63B1F] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        <span className="text-sm text-[#D63B1F] font-medium">{formatPhoneNumber(call.forwarded_to)}</span>
                      </div>
                    ) : (
                      getStatusBadge(call)
                    )}
                  </div>

                  <div>
                    <span className="text-sm text-[#9B9890]">{formatDuration(call.duration_seconds)}</span>
                  </div>

                  <div>
                    <span className="text-xs text-[#9B9890]">{formatDate(call.created_at)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <p className="text-xs text-[#9B9890]">
              Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
