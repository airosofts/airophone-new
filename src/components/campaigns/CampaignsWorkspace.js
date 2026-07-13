'use client'

// Full-page ChatGPT-style campaigns workspace for the SMS tab: a left history
// sidebar of past campaigns + a right panel that is either the AI builder (new)
// or the selected campaign's detail. The SMS/RVM tabs live in the right-panel
// header (passed down as `tabs`). The main app sidebar and the tab still work.
import { useState, useEffect, useCallback } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'
import CampaignAgentChat from './CampaignAgentChat'
import CampaignDetail from './CampaignDetail'

const STATUS_DOT = { running: '#16A34A', sending: '#16A34A', scheduled: '#2563EB', paused: '#CA8A04', completed: '#2563EB', draft: '#9B9890', archived: '#B5B2AA', failed: '#DC2626' }
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

export default function CampaignsWorkspace({ onManual, activeTab = 'sms', setActiveTab }) {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)   // null = AI chat (new)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const d = await fetchWithWorkspace('/api/campaigns').then(r => r.json()).catch(() => ({}))
    setCampaigns(d?.campaigns || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const selected = campaigns.find(c => c.id === selectedId) || null
  const filtered = campaigns.filter(c => !search || (c.name || '').toLowerCase().includes(search.toLowerCase()))

  const onCreated = async (campaign) => { await load(); if (campaign?.id) setSelectedId(campaign.id) }
  const onDeleted = async () => { setSelectedId(null); await load() }

  const Tab = ({ id, icon, label }) => (
    <button onClick={() => setActiveTab?.(id)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm transition-colors bg-white ${activeTab === id ? 'border-[#D63B1F]' : 'border-[#E3E1DB] hover:border-[#9B9890]'}`}>
      <i className={`fas ${icon} text-xs ${activeTab === id ? 'text-[#D63B1F]' : 'text-[#9B9890]'}`} />
      <span className={activeTab === id ? 'font-semibold text-[#131210]' : 'font-medium text-[#5C5A55]'}>{label}</span>
    </button>
  )
  const tabsEl = (
    <div className="flex items-center gap-1.5 shrink-0">
      <Tab id="sms" icon="fa-comment-sms" label="SMS" />
      <Tab id="rvm" icon="fa-voicemail" label="Ringless Voicemail" />
    </div>
  )

  return (
    <div className="h-full flex bg-white overflow-hidden border-t border-[#E3E1DB]" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* History sidebar */}
      <div className="w-72 shrink-0 border-r border-[#E3E1DB] flex flex-col bg-[#FBFAF8]">
        <div className="p-3 border-b border-[#E3E1DB]">
          <div className="relative">
            <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search campaigns…"
              className="w-full pl-7 pr-2 py-2 border border-[#E3E1DB] rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#D63B1F]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? <p className="px-4 py-3 text-xs text-[#9B9890]">Loading…</p>
            : filtered.length === 0 ? <p className="px-4 py-3 text-xs text-[#9B9890]">No campaigns yet.</p>
              : filtered.map(c => (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${selectedId === c.id ? 'bg-white border-[#D63B1F]' : 'border-transparent hover:bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT[c.status] || '#9B9890' }} />
                    <span className="text-sm text-[#131210] truncate flex-1">{c.name}</span>
                    <span className="text-[10px] text-[#9B9890] shrink-0">{fmtDay(c.created_at)}</span>
                  </div>
                  <p className="text-[11px] text-[#9B9890] truncate mt-0.5 pl-3.5">{c.message_template || 'Draft'}</p>
                </button>
              ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0">
        {selected
          ? <CampaignDetail campaign={selected} onChanged={load} onDeleted={onDeleted} tabs={tabsEl} onNew={() => setSelectedId(null)} />
          : <CampaignAgentChat inline onSwitchToManual={onManual} onCreated={onCreated} headerTabs={tabsEl} />}
      </div>
    </div>
  )
}
