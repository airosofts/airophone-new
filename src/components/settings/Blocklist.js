'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiPost, apiDelete } from '@/lib/api-client'
import { getCurrentUser } from '@/lib/auth'

export default function Blocklist() {
  const [blocked, setBlocked] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [newNumber, setNewNumber] = useState('')
  const [blocking, setBlocking] = useState(false)
  const [unblockingId, setUnblockingId] = useState(null)

  const currentUser = getCurrentUser()

  const fetchBlocked = useCallback(async () => {
    try {
      const res = await apiGet('/api/contacts/block')
      const data = await res.json()
      if (data.success) setBlocked(data.blocked)
    } catch (e) {
      console.error('Error fetching blocklist:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBlocked()
  }, [fetchBlocked])

  const handleUnblock = async (phoneNumber, id) => {
    setUnblockingId(id)
    try {
      await apiDelete(`/api/contacts/block?phoneNumber=${encodeURIComponent(phoneNumber)}`)
      setBlocked(prev => prev.filter(b => b.id !== id))
    } catch (e) {
      console.error('Error unblocking:', e)
    } finally {
      setUnblockingId(null)
    }
  }

  const handleBlock = async () => {
    if (!newNumber.trim()) return
    setBlocking(true)
    try {
      const res = await apiPost('/api/contacts/block', { phoneNumber: newNumber.trim() })
      if (res.ok) {
        await fetchBlocked()
        setNewNumber('')
        setShowBlockForm(false)
      }
    } catch (e) {
      console.error('Error blocking:', e)
    } finally {
      setBlocking(false)
    }
  }

  const getBlockedByLabel = (blockedBy) => {
    if (!blockedBy) return 'Unknown'
    if (blockedBy === currentUser?.userId) return 'You'
    return 'Team member'
  }

  const filtered = blocked.filter(b =>
    b.phone_number.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-[#131210]">Blocklist</h2>
          <p className="text-sm text-[#9B9890] mt-1">Manage all blocked numbers in your workspace</p>
        </div>
        <button
          onClick={() => setShowBlockForm(true)}
          className="px-4 py-2 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Block a number
        </button>
      </div>

      {/* Inline block form */}
      {showBlockForm && (
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg p-4 mb-4">
          <p className="text-sm font-medium text-[#131210] mb-3">Enter the phone number to block</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newNumber}
              onChange={e => setNewNumber(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleBlock()}
              placeholder="+1 (555) 000-0000"
              className="flex-1 px-3 py-2 text-sm border border-[#D4D1C9] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
              autoFocus
            />
            <button
              onClick={handleBlock}
              disabled={blocking || !newNumber.trim()}
              className="px-4 py-2 bg-[#D63B1F] hover:bg-[#c23119] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {blocking ? 'Blocking…' : 'Block'}
            </button>
            <button
              onClick={() => { setShowBlockForm(false); setNewNumber('') }}
              className="px-4 py-2 text-sm text-[#5C5A55] hover:bg-[#F7F6F3] rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main card */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
        {/* Search */}
        <div className="p-4 border-b border-[#E3E1DB]">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9B9890]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search for a number"
              className="w-full pl-9 pr-4 py-2 text-sm border border-[#E3E1DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-8 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 bg-[#EFEDE8] rounded w-36" />
                <div className="h-4 bg-[#EFEDE8] rounded w-32" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 bg-[#EFEDE8] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#9B9890]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#5C5A55]">
              {search ? 'No numbers match your search' : 'No blocked numbers'}
            </p>
            {!search && (
              <p className="text-xs text-[#9B9890] mt-1">Blocked numbers won't be able to reach you</p>
            )}
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_1fr_100px] px-5 py-2.5 border-b border-[#E3E1DB] bg-[#F7F6F3]/50 rounded-none">
              <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">Number</span>
              <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">Blocked by</span>
              <span />
            </div>

            {/* Rows */}
            {filtered.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_1fr_100px] items-center px-5 py-3.5 border-b border-[#EFEDE8] last:border-0 hover:bg-[#F7F6F3]"
              >
                <span className="text-sm text-[#131210] font-medium">{item.phone_number}</span>

                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#EFEDE8] flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-[#9B9890]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  </div>
                  <span className="text-sm text-[#5C5A55]">{getBlockedByLabel(item.blocked_by)}</span>
                </div>

                {/* Direct Unblock button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => handleUnblock(item.phone_number, item.id)}
                    disabled={unblockingId === item.id}
                    className="px-3 py-1 text-xs font-medium text-[#5C5A55] hover:text-red-600 border border-[#E3E1DB] hover:border-red-300 rounded-md transition-colors disabled:opacity-50"
                  >
                    {unblockingId === item.id ? 'Removing…' : 'Unblock'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
