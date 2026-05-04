'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiPost, apiDelete, fetchWithWorkspace } from '@/lib/api-client'

export default function CallForwarding() {
  const [rules, setRules] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedPhoneId, setSelectedPhoneId] = useState('')
  const [forwardTo, setForwardTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const fetchRules = useCallback(async () => {
    try {
      const res = await apiGet('/api/call-forwarding')
      const data = await res.json()
      if (data.success) setRules(data.rules)
    } catch (e) {
      console.error('Error fetching forwarding rules:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPhoneNumbers = useCallback(async () => {
    try {
      const res = await apiGet('/api/phone-numbers')
      const data = await res.json()
      if (data.success) setPhoneNumbers(data.phoneNumbers || [])
    } catch (e) {
      console.error('Error fetching phone numbers:', e)
    }
  }, [])

  useEffect(() => {
    fetchRules()
    fetchPhoneNumbers()
  }, [fetchRules, fetchPhoneNumbers])

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const handleAdd = async () => {
    if (!selectedPhoneId || !forwardTo.trim()) return
    setSaving(true)
    try {
      const res = await apiPost('/api/call-forwarding', {
        phone_number_id: selectedPhoneId,
        forward_to: forwardTo.trim()
      })
      const data = await res.json()
      if (data.success) {
        await fetchRules()
        setShowAddForm(false)
        setSelectedPhoneId('')
        setForwardTo('')
      }
    } catch (e) {
      console.error('Error creating rule:', e)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (rule) => {
    setTogglingId(rule.id)
    try {
      await fetchWithWorkspace('/api/call-forwarding', {
        method: 'PATCH',
        body: JSON.stringify({ id: rule.id, is_active: !rule.is_active })
      })
      await fetchRules()
    } catch (e) {
      console.error('Error toggling rule:', e)
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id) => {
    setDeletingId(id)
    try {
      await apiDelete(`/api/call-forwarding?id=${id}`)
      setRules(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      console.error('Error deleting rule:', e)
    } finally {
      setDeletingId(null)
    }
  }

  // Phone numbers that don't already have an active rule
  const availableNumbers = phoneNumbers.filter(
    pn => !rules.some(r => r.phone_number_id === pn.id && r.is_active)
  )

  return (
    <div className="w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-[#131210]">Call Forwarding</h2>
          <p className="text-sm text-[#9B9890] mt-1">
            Automatically forward incoming calls on your lines to another number
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          disabled={availableNumbers.length === 0}
          className="shrink-0 px-3 py-2 bg-[#D63B1F] hover:bg-[#c23119] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Add Forwarding Rule</span>
          <span className="sm:hidden">Add Rule</span>
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg p-4 mb-4">
          <p className="text-sm font-medium text-[#131210] mb-3">Set up call forwarding</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#9B9890] mb-1">Forward calls from</label>
              <select
                value={selectedPhoneId}
                onChange={e => setSelectedPhoneId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4D1C9] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F] bg-[#FFFFFF]"
              >
                <option value="">Select a phone line</option>
                {availableNumbers.map(pn => (
                  <option key={pn.id} value={pn.id}>
                    {pn.custom_name ? `${pn.custom_name} — ${formatPhoneNumber(pn.phoneNumber)}` : formatPhoneNumber(pn.phoneNumber)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9B9890] mb-1">Forward to number</label>
              <input
                type="text"
                value={forwardTo}
                onChange={e => setForwardTo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3 py-2 text-sm border border-[#D4D1C9] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                autoFocus
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAdd}
                disabled={saving || !selectedPhoneId || !forwardTo.trim()}
                className="flex-1 sm:flex-none px-4 py-2.5 bg-[#D63B1F] hover:bg-[#c23119] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save Rule'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setSelectedPhoneId(''); setForwardTo('') }}
                className="flex-1 sm:flex-none px-4 py-2.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
        {loading ? (
          <div className="p-8 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 bg-[#EFEDE8] rounded w-40" />
                <div className="h-4 bg-[#EFEDE8] rounded w-8" />
                <div className="h-4 bg-[#EFEDE8] rounded w-36" />
              </div>
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 bg-[#EFEDE8] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[#9B9890]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#5C5A55]">No forwarding rules</p>
            <p className="text-xs text-[#9B9890] mt-1">
              Add a rule to automatically forward incoming calls to another number
            </p>
          </div>
        ) : (
          <>
            {/* Column headers — desktop only */}
            <div className="hidden sm:grid grid-cols-[1fr_auto_1fr_100px] px-5 py-2.5 border-b border-[#E3E1DB] bg-[#F7F6F3]/50">
              <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">From Line</span>
              <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider px-4">Status</span>
              <span className="text-xs font-medium text-[#9B9890] uppercase tracking-wider">Forward To</span>
              <span />
            </div>

            {/* Rows */}
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="px-5 py-3.5 border-b border-[#EFEDE8] last:border-0 hover:bg-[#F7F6F3] sm:grid sm:grid-cols-[1fr_auto_1fr_100px] sm:items-center"
              >
                {/* Mobile layout */}
                <div className="flex items-center justify-between sm:contents">
                  {/* From line */}
                  <div>
                    <p className="text-sm text-[#131210] font-medium">
                      {rule.phone_numbers?.custom_name || formatPhoneNumber(rule.phone_numbers?.phone_number)}
                    </p>
                    {rule.phone_numbers?.custom_name && (
                      <p className="text-xs text-[#9B9890]">{formatPhoneNumber(rule.phone_numbers?.phone_number)}</p>
                    )}
                  </div>

                  {/* Toggle */}
                  <div className="sm:px-4">
                    <button
                      onClick={() => handleToggle(rule)}
                      disabled={togglingId === rule.id}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        rule.is_active ? 'bg-[#D63B1F]' : 'bg-[#D4D1C9]'
                      } ${togglingId === rule.id ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[#FFFFFF] transition-transform ${
                          rule.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Forward to + Delete */}
                <div className="flex items-center justify-between mt-2 sm:mt-0 sm:contents">
                  {/* Forward to */}
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-[#9B9890] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-sm text-[#5C5A55]">{formatPhoneNumber(rule.forward_to)}</span>
                  </div>

                  {/* Delete */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      disabled={deletingId === rule.id}
                      className="px-3 py-1 text-xs font-medium text-[#5C5A55] hover:text-red-600 border border-[#E3E1DB] hover:border-red-300 rounded-md transition-colors disabled:opacity-50"
                    >
                      {deletingId === rule.id ? 'Removing…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
