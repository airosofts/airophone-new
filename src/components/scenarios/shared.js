'use client'

// Shared building blocks for the scenario create/edit pages.

import { useState, useEffect, useCallback } from 'react'
import { apiGet, fetchWithWorkspace } from '@/lib/api-client'

export const STANDARD_TAGS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'business_name', label: 'Company' },
  { key: 'phone_number', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
]

export const _DOWLBL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const _TZLBL = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Los_Angeles': 'PT', 'America/Phoenix': 'MST', 'America/Anchorage': 'AKT', 'Pacific/Honolulu': 'HST', 'UTC': 'UTC' }
export function fmtBizT(t) {
  const [h, m] = String(t || '09:00').split(':').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1, h || 0, m || 0)))
}
export function fmtBizDays(days) {
  const d = [...new Set(days || [1, 2, 3, 4, 5])].sort((a, b) => a - b)
  if (!d.length) return '—'
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1)
  return contiguous && d.length > 1 ? `${_DOWLBL[d[0]]}–${_DOWLBL[d[d.length - 1]]}` : d.map(n => _DOWLBL[n]).join(', ')
}

export function InstructionTagBar({ taId, value, onChange, listColumns }) {
  const allTags = [
    ...STANDARD_TAGS,
    ...listColumns.map(col => ({ key: col.key, label: col.label, isCustom: true })),
  ]
  const insertTag = (key) => {
    const ta = document.getElementById(taId)
    const start = ta ? ta.selectionStart : value.length
    const tag = `{{${key}}}`
    const next = value.slice(0, start) + tag + value.slice(start)
    onChange(next)
    setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(start + tag.length, start + tag.length) } }, 0)
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
      <span className="text-[10px] text-[#9B9890] mr-0.5">Insert:</span>
      {allTags.map(tag => (
        <button key={tag.key} type="button" onClick={() => insertTag(tag.key)}
          className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors ${tag.isCustom ? 'bg-[#FFF7F5] border-[#F4C5BB] text-[#D63B1F] hover:bg-[#FFEDE8]' : 'bg-[#F7F6F3] border-[#D4D1C9] text-[#5C5A55] hover:bg-[#EFEDE8]'}`}
          title={tag.label}
        >{`{{${tag.key}}}`}</button>
      ))}
    </div>
  )
}

export function ContactRestrictionPicker({ contactLists, selectedListIds, onListToggle, individualContacts, onAddContact, onRemoveContact }) {
  const [tab, setTab] = useState('lists')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [manualPhone, setManualPhone] = useState('')

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    try {
      const res = await apiGet(`/api/contacts?q=${encodeURIComponent(q)}`)
      const d = await res.json()
      setSearchResults(d.contacts || [])
    } catch {}
    setSearching(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQ), 300)
    return () => clearTimeout(t)
  }, [searchQ, doSearch])

  const addManual = () => {
    const phone = manualPhone.trim().replace(/\s/g, '')
    if (!phone) return
    onAddContact({ phone, label: phone })
    setManualPhone('')
  }

  const tabBtn = (key, label) => (
    <button type="button" onClick={() => setTab(key)}
      className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${tab === key ? 'bg-[#D63B1F] text-white' : 'text-[#5C5A55] hover:bg-[#F7F6F3]'}`}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <label className="block text-xs font-medium text-[#5C5A55]">Contact Restrictions</label>
          <p className="text-[11px] text-[#9B9890] mt-0.5">Leave empty to apply to all contacts.</p>
        </div>
        <div className="flex gap-1 bg-[#F7F6F3] rounded-md p-0.5">
          {tabBtn('lists', 'By List')}
          {tabBtn('search', 'Search')}
          {tabBtn('manual', 'Manual')}
        </div>
      </div>

      {tab === 'lists' && (
        <div className="space-y-1.5 max-h-36 overflow-y-auto border border-[#E3E1DB] rounded-md p-2">
          {contactLists.length === 0
            ? <p className="text-xs text-[#9B9890] py-1">No contact lists found</p>
            : contactLists.map(cl => (
              <label key={cl.id} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={selectedListIds.includes(cl.id)}
                  onChange={(e) => onListToggle(cl.id, e.target.checked)} className="accent-[#D63B1F]" />
                <span className="text-sm text-[#5C5A55] flex-1">{cl.name}</span>
                <span className="text-xs text-[#9B9890]">{cl.contactCount} contacts</span>
              </label>
            ))}
        </div>
      )}

      {tab === 'search' && (
        <div>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Search by name, business, or phone..."
            className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
          <div className="max-h-32 overflow-y-auto border border-[#E3E1DB] rounded-md">
            {searching && <p className="text-xs text-[#9B9890] p-3">Searching…</p>}
            {!searching && searchQ && searchResults.length === 0 && <p className="text-xs text-[#9B9890] p-3">No contacts found</p>}
            {searchResults.map(c => {
              const phone = c.phone_number
              const already = individualContacts.some(x => x.phone === phone)
              const label = [c.first_name, c.last_name, c.business_name].filter(Boolean).join(' ') || phone
              return (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 border-b border-[#F7F6F3] last:border-0">
                  <div>
                    <div className="text-sm text-[#131210]">{label}</div>
                    <div className="text-xs text-[#9B9890]">{phone}</div>
                  </div>
                  <button type="button" disabled={already}
                    onClick={() => onAddContact({ phone, id: c.id, label })}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${already ? 'border-[#E3E1DB] text-[#9B9890] cursor-not-allowed' : 'border-[#D63B1F] text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)]'}`}>
                    {already ? 'Added' : 'Add'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'manual' && (
        <div className="flex gap-2">
          <input value={manualPhone} onChange={e => setManualPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addManual())}
            placeholder="+1 (555) 000-0000"
            className="flex-1 px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
          <button type="button" onClick={addManual}
            className="px-3 py-2 text-sm font-medium bg-[#D63B1F] text-white rounded-md hover:bg-[#c23119]">Add</button>
        </div>
      )}

      {individualContacts.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] text-[#9B9890] mb-1.5">Added contacts/numbers ({individualContacts.length}):</p>
          <div className="flex flex-wrap gap-1.5">
            {individualContacts.map(c => (
              <span key={c.phone} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.15)] text-[#D63B1F] rounded text-xs">
                {c.label || c.phone}
                <button type="button" onClick={() => onRemoveContact(c.phone)} className="hover:text-[#a02e17]">
                  <i className="fas fa-times text-[9px]"></i>
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {(selectedListIds.length > 0 || individualContacts.length > 0) && (
        <div className="mt-2.5 p-3 bg-[rgba(214,59,31,0.06)] border border-[rgba(214,59,31,0.2)] rounded-lg">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-[12px] font-semibold text-[#D63B1F]">
              <i className="fas fa-filter mr-1"></i> AI will only reply to:
            </p>
            <button type="button"
              onClick={() => { selectedListIds.forEach(id => onListToggle(id, false)); individualContacts.forEach(c => onRemoveContact(c.phone)) }}
              className="text-[11px] text-[#9B9890] hover:text-[#D63B1F]">
              Clear all
            </button>
          </div>
          <ul className="text-[12px] text-[#5C5A55] space-y-0.5 leading-relaxed">
            {selectedListIds.length > 0 && (
              <li>• Contacts in: <span className="font-medium text-[#131210]">{selectedListIds.map(id => contactLists.find(cl => cl.id === id)?.name).filter(Boolean).join(', ')}</span></li>
            )}
            {individualContacts.length > 0 && (
              <li>• {individualContacts.length} individually-pinned number{individualContacts.length > 1 ? 's' : ''}</li>
            )}
          </ul>
          <p className="text-[11px] text-[#9B9890] mt-1.5 italic">Anyone else who texts this scenario&rsquo;s phone number will be ignored.</p>
        </div>
      )}
    </div>
  )
}
