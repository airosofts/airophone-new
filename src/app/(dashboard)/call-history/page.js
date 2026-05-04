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
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path fill="#ef4444" d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
            <line stroke="#ef4444" strokeWidth="1.5" x1="12.5" y1="2.5" x2="17.5" y2="7.5" /><line stroke="#ef4444" strokeWidth="1.5" x1="17.5" y1="2.5" x2="12.5" y2="7.5" />
          </svg>
        </div>
      )
    }
    if (isInbound) {
      return (
        <div className="w-7 h-7 rounded-full bg-[rgba(214,59,31,0.07)] flex items-center justify-center flex-shrink-0" title="Incoming">
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path fill="#D63B1F" d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
            <polyline stroke="#D63B1F" strokeWidth="1.5" points="13 1.5 13 6 17.5 6" /><line stroke="#D63B1F" strokeWidth="1.5" x1="18.5" y1="1" x2="13" y2="6" />
          </svg>
        </div>
      )
    }
    return (
      <div className="w-7 h-7 rounded-full bg-[#D63B1F]/10 flex items-center justify-center flex-shrink-0" title="Outgoing">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path fill="#D63B1F" d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
          <polyline stroke="#D63B1F" strokeWidth="1.5" points="17.5 6 17.5 1.5 13 1.5" /><line stroke="#D63B1F" strokeWidth="1.5" x1="12" y1="6.5" x2="17.5" y2="1.5" />
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
