'use client'

// Full-page ChatGPT-style ringless-voicemail workspace for the RVM tab: a left
// history sidebar of past voicemail campaigns + a right panel that is either the
// AI builder (new) or the selected campaign's detail. Sibling of
// CampaignsWorkspace (the SMS one is untouched). The SMS/RVM tabs live in the
// right-panel header (passed down as `tabs`).
import { useState, useEffect, useCallback } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'
import VoicemailAgentChat from './VoicemailAgentChat'
import VoicemailDetail from './VoicemailDetail'

const STATUS_DOT = { running: '#16A34A', paused: '#CA8A04', completed: '#2563EB', draft: '#9B9890', failed: '#DC2626' }
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

export default function VoicemailWorkspace({ onManual, onEdit, activeTab = 'rvm', setActiveTab }) {
  const [campaigns, setCampaigns] = useState([])
  const [contactLists, setContactLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)   // null = AI chat (new)
  const [search, setSearch] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const load = useCallback(async () => {
    const d = await fetchWithWorkspace('/api/voicemail-campaigns').then(r => r.json()).catch(() => ({}))
    setCampaigns(d?.campaigns || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetchWithWorkspace('/api/contact-lists').then(r => r.json()).then(d => {
      setContactLists(d?.contactLists || d?.lists || (Array.isArray(d) ? d : []))
    }).catch(() => {})
  }, [])

  const selected = campaigns.find(c => c.id === selectedId) || null
  const filtered = campaigns.filter(c => !search || (c.name || '').toLowerCase().includes(search.toLowerCase()))

  const onCreated = async (campaign) => { await load(); if (campaign?.id) setSelectedId(campaign.id) }
  const onDeleted = async () => { setSelectedId(null); await load() }

  const Tab = ({ id, icon, label }) => {
    const on = activeTab === id
    return (
      <button onClick={() => setActiveTab?.(id)}
        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm transition-colors ${on ? 'bg-[#D63B1F] shadow-sm' : 'hover:bg-white'}`}>
        <i className={`fas ${icon} text-xs ${on ? 'text-white' : 'text-[#9B9890]'}`} />
        <span className={on ? 'font-semibold text-white' : 'font-medium text-[#5C5A55]'}>{label}</span>
      </button>
    )
  }
  const tabsEl = (
    <div className="inline-flex items-center gap-1 p-1 bg-[#F1EFEA] border border-[#E3E1DB] rounded-lg shrink-0">
      <Tab id="sms" icon="fa-comment-sms" label="SMS" />
      <Tab id="rvm" icon="fa-voicemail" label="Ringless Voicemail" />
    </div>
  )

  return (
    <div className="h-full flex bg-white overflow-hidden border-t border-[#E3E1DB]" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* History sidebar — collapsible, with a New ringless voicemail button on top */}
      {sidebarCollapsed ? (
        <div className="flex flex-col items-center gap-1.5 w-12 shrink-0 border-r border-[#E3E1DB] bg-[#FBFAF8] py-3">
          <button type="button" onClick={() => setSidebarCollapsed(false)} title="Expand"
            className="w-8 h-8 rounded-lg text-[#5C5A55] hover:bg-white flex items-center justify-center">
            <i className="fas fa-chevron-right text-xs" />
          </button>
          <button type="button" onClick={() => setSelectedId(null)} title="New ringless voicemail"
            className="w-8 h-8 rounded-lg bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center">
            <i className="fas fa-plus text-xs" />
          </button>
        </div>
      ) : (
        <div className="w-72 shrink-0 border-r border-[#E3E1DB] flex flex-col bg-[#FBFAF8]">
          <div className="p-3 pb-2 flex items-center gap-2">
            <button type="button" onClick={() => setSelectedId(null)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg transition-colors">
              <i className="fas fa-plus text-xs" /> New ringless voicemail
            </button>
            <button type="button" onClick={() => setSidebarCollapsed(true)} title="Collapse"
              className="w-8 h-8 rounded-lg text-[#9B9890] hover:bg-white hover:text-[#5C5A55] flex items-center justify-center shrink-0">
              <i className="fas fa-chevron-left text-xs" />
            </button>
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search voicemails…"
                className="w-full pl-7 pr-2 py-2 border border-[#E3E1DB] rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#D63B1F]" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {loading ? <p className="px-4 py-3 text-xs text-[#9B9890]">Loading…</p>
              : filtered.length === 0 ? <p className="px-4 py-3 text-xs text-[#9B9890]">No voicemail campaigns yet.</p>
                : filtered.map(c => (
                  <button key={c.id} onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${selectedId === c.id ? 'bg-white border-[#D63B1F]' : 'border-transparent hover:bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT[c.status] || '#9B9890' }} />
                      <span className="text-sm text-[#131210] truncate flex-1">{c.name}</span>
                      <span className="text-[10px] text-[#9B9890] shrink-0">{fmtDay(c.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-[#9B9890] truncate mt-0.5 pl-3.5">
                      {c.sender_number || 'Draft'}{typeof c.total_recipients === 'number' ? ` · ${c.total_recipients.toLocaleString()} recipients` : ''}
                    </p>
                  </button>
                ))}
          </div>
        </div>
      )}

      {/* Right panel */}
      <div className="flex-1 min-w-0">
        {selected
          ? <VoicemailDetail campaign={selected} contactLists={contactLists} onChanged={load} onDeleted={onDeleted} onEdit={onEdit} tabs={tabsEl} onNew={() => setSelectedId(null)} />
          : <VoicemailAgentChat inline onSwitchToManual={onManual} onCreated={onCreated} headerTabs={tabsEl} />}
      </div>
    </div>
  )
}
