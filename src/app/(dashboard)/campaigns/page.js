// app/campaigns/page.jsx
'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import SearchableDropdown from '@/components/SearchableDropdown'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { estimateSendSchedule } from '@/lib/scheduling'
import { CONTACT_STATUSES, CONTACT_STATUS_MAP, DEFAULT_EXCLUDED_STATUSES } from '@/lib/contact-status'

// Encode mono Float32 PCM samples into a 16-bit WAV (audio/wav) — the upload
// route + VoiceDrop accept WAV, but MediaRecorder only gives webm/mp4, so the
// live recorder captures raw PCM and encodes here.
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeStr(36, 'data'); view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2 }
  return view
}

// Friendly "how long" from a millisecond span: "about 2 min", "about 3 hours".
function humanizeSpan(ms) {
  const mins = ms / 60000
  if (mins < 1.5) return 'under a minute'
  if (mins < 90) return `about ${Math.round(mins)} min`
  const hours = mins / 60
  if (hours < 24) { const h = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours); return `about ${h} hour${h === 1 ? '' : 's'}` }
  const days = Math.round(hours / 24)
  return `about ${days} day${days === 1 ? '' : 's'}`
}

// Recommended RVM send-rate presets, keyed by team size. Each maps to a
// concrete (count, window-seconds) the backend sweeper enforces — derived from
// the "spacing/interval" guidance. `callbacks` is shown to help users pick by
// the inbound load their team can handle; `window: null` (Enterprise) = no throttle.
const THROTTLE_PRESETS = [
  { id: 'solo',  team: 'Solo Entrepreneur',         volume: '20–30',   callbacks: '1–2 callbacks / hr',   count: 1,    window: 150  }, // 1 every 2.5 min ≈ 24/hr
  { id: 'small', team: 'Small Team (2–3 agents)',   volume: '100',     callbacks: '5–8 callbacks / hr',   count: 25,   window: 900  }, // 25 every 15 min
  { id: 'mid',   team: 'Mid-Sized Team (5+ agents)', volume: '200–250', callbacks: '12–20 callbacks / hr', count: 50,   window: 900  }, // 50 every 15 min
  { id: 'ent',   team: 'Enterprise / AI Agent',     volume: '500+',    callbacks: 'Uncapped',             count: null, window: null }, // continuous (no throttle)
]

// Calling-window schedule presets. Voicemails only send during these local
// windows; the throttle paces the rate within them.
const SCHEDULE_PRESETS = {
  best:     [{ start: '10:00', end: '12:00' }, { start: '14:00', end: '16:00' }],
  business: [{ start: '09:00', end: '17:00' }],
}
// Common US timezones for the schedule's basis.
const TIMEZONES = [
  { id: 'America/New_York',    label: 'Eastern (ET)' },
  { id: 'America/Chicago',     label: 'Central (CT)' },
  { id: 'America/Denver',      label: 'Mountain (MT)' },
  { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
]

// RVM costs 2 credits per voicemail. Extra credits beyond a plan's monthly
// allowance are billed at the plan's overage rate (mirrors billing/page.js).
const RVM_CREDITS_PER_VM = 2
const PLAN_OVERAGE = {
  starter:    { name: 'Starter',    rate: 0.04 },
  growth:     { name: 'Growth',     rate: 0.03 },
  enterprise: { name: 'Enterprise', rate: 0.02 },
}
const DEFAULT_OVERAGE = { name: 'your plan', rate: 0.04 }   // conservative fallback

// ISO weekday (1=Mon..7=Sun) helpers for business-day display.
const WEEKDAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' }
const hhmm = (t) => String(t || '').slice(0, 5)   // "09:00:00" → "09:00"
function formatDays(days) {
  if (!Array.isArray(days) || days.length === 0 || days.length === 7) return 'every day'
  const key = [...days].sort((a, b) => a - b).join(',')
  if (key === '1,2,3,4,5') return 'Mon–Fri'
  if (key === '6,7') return 'weekends'
  return [...days].sort((a, b) => a - b).map(d => WEEKDAY_LABELS[d]).join(', ')
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([])
  const [contactLists, setContactLists] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [showCreateCampaign, setShowCreateCampaign] = useState(false)
  const [showViewCampaign, setShowViewCampaign] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [errorModal, setErrorModal] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [creditBalance, setCreditBalance] = useState(0)
  const [showTrialUpsell, setShowTrialUpsell] = useState(false)

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const launchingIdsRef = useRef(new Set())

  // Tab
  const [activeTab, setActiveTab] = useState('sms')

  // RVM state
  const [rvmCampaigns, setRvmCampaigns] = useState([])
  const [rvmLoading, setRvmLoading] = useState(false)
  const [showCreateRVM, setShowCreateRVM] = useState(false)
  const [showViewRVM, setShowViewRVM] = useState(false)
  const [selectedRVMCampaign, setSelectedRVMCampaign] = useState(null)
  const [rvmDeleteConfirm, setRvmDeleteConfirm] = useState(null)
  const [rvmSearchTerm, setRvmSearchTerm] = useState('')
  const [rvmStatusFilter, setRvmStatusFilter] = useState('all')
  const [rvmCurrentPage, setRvmCurrentPage] = useState(1)
  const rvmLaunchingIdsRef = useRef(new Set())

  const fetchCampaigns = useCallback(async () => {
    try {
      if (!loading) {
        const response = await apiGet('/api/campaigns')
        const data = await response.json()
        if (data.success) setCampaigns(data.campaigns)
      } else {
        setLoading(true)
        const response = await apiGet('/api/campaigns')
        const data = await response.json()
        if (data.success) setCampaigns(data.campaigns)
        setLoading(false)
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error)
      if (!loading) return
      setErrorModal({ title: 'Error', message: 'Failed to load campaigns. Please try again.' })
      setLoading(false)
    }
  }, [loading])

  const fetchRVMCampaigns = useCallback(async () => {
    try {
      const response = await apiGet('/api/voicemail-campaigns')
      const data = await response.json()
      if (data.success) setRvmCampaigns(data.campaigns || [])
    } catch (error) {
      console.error('Error fetching RVM campaigns:', error)
    }
  }, [])

  useEffect(() => {
    fetchCampaigns()
    const interval = setInterval(fetchCampaigns, 5000)
    return () => clearInterval(interval)
  }, [fetchCampaigns])

  useEffect(() => {
    fetchRVMCampaigns()
    const interval = setInterval(fetchRVMCampaigns, 5000)
    return () => clearInterval(interval)
  }, [fetchRVMCampaigns])

  useEffect(() => {
    const open = () => setShowCreateCampaign(true)
    const close = () => setShowCreateCampaign(false)
    window.addEventListener('tour:open-campaign-modal', open)
    window.addEventListener('tour:close-campaign-modal', close)
    return () => {
      window.removeEventListener('tour:open-campaign-modal', open)
      window.removeEventListener('tour:close-campaign-modal', close)
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = getCurrentUser()
        setUser(user)
        const [contactListRes, phoneNumberRes, subRes] = await Promise.all([
          apiGet('/api/contact-lists'),
          apiGet('/api/phone-numbers'),
          fetch('/api/subscription', {
            headers: { 'x-workspace-id': user?.workspaceId, 'x-user-id': user?.userId },
          }),
        ])
        const contactListData = await contactListRes.json()
        const phoneNumberData = await phoneNumberRes.json()
        const subData = await subRes.json()
        if (contactListData.success) setContactLists(contactListData.contactLists || [])
        if (phoneNumberData.success) setPhoneNumbers(phoneNumberData.phoneNumbers || [])
        if (subData.subscription) setSubscription(subData.subscription)
        if (typeof subData.credits === 'number') setCreditBalance(subData.credits)
      } catch (error) {
        console.error('Error fetching data:', error)
      }
    }
    fetchData()
  }, [])

  const handleDeleteCampaign = async (campaignId) => {
    try {
      const response = await apiPost(`/api/campaigns/${campaignId}/delete`, {})
      const data = await response.json()
      if (data.success) {
        setDeleteConfirm(null)
        setSelectedCampaign(null)
        setShowViewCampaign(false)
        await fetchCampaigns()
      } else {
        setErrorModal({ title: 'Error', message: data.error || 'Failed to delete campaign' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to delete campaign. Please try again.' })
    }
  }

  const handlePauseCampaign = async (campaignId, isPaused) => {
    try {
      const response = await apiPost(`/api/campaigns/${campaignId}/pause`, { is_paused: !isPaused })
      const data = await response.json()
      if (data.success) {
        await fetchCampaigns()
      } else {
        setErrorModal({ title: 'Error', message: data.error || 'Failed to update campaign' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to update campaign. Please try again.' })
    }
  }

  const handleLaunchCampaign = async (campaignId) => {
    if (subscription?.status === 'trialing') {
      setShowTrialUpsell(true)
      return
    }
    if (launchingIdsRef.current.has(campaignId)) return
    launchingIdsRef.current.add(campaignId)
    try {
      const response = await apiPost(`/api/campaigns/${campaignId}/start`, {})
      const data = await response.json()
      if (response.status === 402 && data.error === 'trial_restriction') {
        setShowTrialUpsell(true)
        return
      }
      if (data.success) {
        setShowViewCampaign(false)
        setSelectedCampaign(null)
        await fetchCampaigns()
      } else {
        setErrorModal({ title: 'Cannot Launch', message: data.message || data.error || 'Failed to start campaign' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to start campaign. Please try again.' })
    } finally {
      launchingIdsRef.current.delete(campaignId)
    }
  }

  const handleArchiveCampaign = async (campaignId, isArchived) => {
    try {
      const response = await apiPost(`/api/campaigns/${campaignId}/archive`, { is_archived: !isArchived })
      const data = await response.json()
      if (data.success) {
        await fetchCampaigns()
      } else {
        setErrorModal({ title: 'Error', message: data.error || 'Failed to update campaign' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to update campaign. Please try again.' })
    }
  }

  const handleDeleteRVMCampaign = async (campaignId) => {
    try {
      const response = await apiPost(`/api/voicemail-campaigns/${campaignId}/delete`, {})
      const data = await response.json()
      if (data.success) {
        setRvmDeleteConfirm(null)
        setSelectedRVMCampaign(null)
        setShowViewRVM(false)
        await fetchRVMCampaigns()
      } else {
        setErrorModal({ title: 'Error', message: data.error || 'Failed to delete campaign' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to delete campaign. Please try again.' })
    }
  }

  const handleLaunchRVMCampaign = async (campaignId) => {
    if (rvmLaunchingIdsRef.current.has(campaignId)) return
    rvmLaunchingIdsRef.current.add(campaignId)
    try {
      const response = await apiPost(`/api/voicemail-campaigns/${campaignId}/start`, {})
      const data = await response.json()
      if (data.success) {
        setShowViewRVM(false)
        setSelectedRVMCampaign(null)
        await fetchRVMCampaigns()
      } else {
        setErrorModal({ title: 'Cannot Launch', message: data.message || data.error || 'Failed to start RVM campaign' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to start RVM campaign. Please try again.' })
    } finally {
      rvmLaunchingIdsRef.current.delete(campaignId)
    }
  }

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((campaign) => {
      const searchLower = searchTerm.toLowerCase()
      const matchesSearch =
        campaign.name.toLowerCase().includes(searchLower) ||
        (campaign.message_template || '').toLowerCase().includes(searchLower)
      if (!matchesSearch) return false
      if (statusFilter === 'active' && !['draft', 'running', 'completed'].includes(campaign.status)) return false
      if (statusFilter === 'paused' && campaign.status !== 'paused') return false
      if (statusFilter === 'archived' && campaign.status !== 'archived') return false
      return true
    })
  }, [campaigns, searchTerm, statusFilter])

  const paginatedCampaigns = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredCampaigns.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredCampaigns, currentPage])

  const totalPages = Math.ceil(filteredCampaigns.length / itemsPerPage)

  const filteredRVMCampaigns = useMemo(() => {
    return rvmCampaigns.filter((campaign) => {
      const matchesSearch = campaign.name.toLowerCase().includes(rvmSearchTerm.toLowerCase())
      if (!matchesSearch) return false
      if (rvmStatusFilter === 'active' && !['draft', 'running', 'completed'].includes(campaign.status)) return false
      if (rvmStatusFilter === 'failed' && campaign.status !== 'failed') return false
      return true
    })
  }, [rvmCampaigns, rvmSearchTerm, rvmStatusFilter])

  const paginatedRVMCampaigns = useMemo(() => {
    const startIndex = (rvmCurrentPage - 1) * itemsPerPage
    return filteredRVMCampaigns.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredRVMCampaigns, rvmCurrentPage])

  const totalRVMPages = Math.ceil(filteredRVMCampaigns.length / itemsPerPage)

  useEffect(() => { setCurrentPage(1) }, [searchTerm, statusFilter])
  useEffect(() => { setRvmCurrentPage(1) }, [rvmSearchTerm, rvmStatusFilter])

  const getContactListName = (ids) => {
    if (!ids || !Array.isArray(ids) || ids.length === 0) return 'Unknown'
    const names = ids.map(id => contactLists.find(cl => cl.id === id)?.name).filter(Boolean)
    return names.length > 0 ? names.join(', ') : 'Unknown'
  }

  const formatDate = (dateString) => {
    try {
      return formatInTimeZone(new Date(dateString), 'UTC', 'MMM dd, yyyy HH:mm')
    } catch {
      return dateString
    }
  }

  const getStatusBadge = (campaign) => {
    if (campaign.status === 'archived') return { label: 'Archived', className: 'bg-[#EFEDE8] text-[#5C5A55]' }
    if (campaign.status === 'paused') return { label: 'Paused', className: 'bg-yellow-50 text-yellow-700' }
    if (campaign.status === 'running') return { label: 'Running', className: 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' }
    if (campaign.status === 'completed') return { label: 'Completed', className: 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' }
    if (campaign.status === 'failed') return { label: 'Failed', className: 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' }
    return { label: 'Draft', className: 'bg-green-50 text-green-700' }
  }

  if (loading) {
    return (
      <div className="h-full bg-[#F7F6F3] flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin text-2xl text-[#9B9890] mb-3"></i>
          <p className="text-sm text-[#9B9890]">Loading campaigns…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-[#F7F6F3] overflow-auto">
      <div className="p-6 space-y-4">

        {/* Trial Banner */}
        {subscription?.status === 'trialing' && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 bg-gradient-to-r from-[#fff8f7] to-[#fff3f1] border border-[rgba(214,59,31,0.2)] rounded-lg">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-full bg-[rgba(214,59,31,0.1)] flex items-center justify-center flex-shrink-0">
                <i className="fas fa-rocket text-[#D63B1F] text-xs"></i>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#131210]">Campaigns require a paid subscription</p>
                <p className="text-xs text-[#5C5A55]">Upgrade your plan to unlock SMS campaigns and start sending to your contacts.</p>
              </div>
            </div>
            <button
              onClick={() => setShowTrialUpsell(true)}
              className="flex-shrink-0 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md transition-colors whitespace-nowrap"
            >
              Activate Now
            </button>
          </div>
        )}

        {/* Campaign type tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('sms')}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg transition-colors ${
              activeTab === 'sms' ? 'bg-[#FFFFFF] border-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] hover:border-[#9B9890]'
            }`}
          >
            <i className={`fas fa-comment-sms text-xs ${activeTab === 'sms' ? 'text-[#D63B1F]' : 'text-[#9B9890]'}`}></i>
            <span className={`text-sm ${activeTab === 'sms' ? 'font-semibold text-[#131210]' : 'font-medium text-[#5C5A55]'}`}>SMS</span>
            {activeTab === 'sms' && <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-green-50 text-green-700 rounded-full uppercase tracking-wide">Active</span>}
          </button>
          <button
            onClick={() => setActiveTab('rvm')}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg transition-colors ${
              activeTab === 'rvm' ? 'bg-[#FFFFFF] border-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] hover:border-[#9B9890]'
            }`}
          >
            <i className={`fas fa-voicemail text-xs ${activeTab === 'rvm' ? 'text-[#D63B1F]' : 'text-[#9B9890]'}`}></i>
            <span className={`text-sm ${activeTab === 'rvm' ? 'font-semibold text-[#131210]' : 'font-medium text-[#5C5A55]'}`}>
              <span className="hidden sm:inline">Ringless Voicemail</span>
              <span className="sm:hidden">RVM</span>
            </span>
            {activeTab === 'rvm' && <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-green-50 text-green-700 rounded-full uppercase tracking-wide">Active</span>}
          </button>
        </div>

        {/* ── SMS Section ── */}
        {activeTab === 'sms' && (
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
            <div data-tour="campaigns-header" className="px-4 py-3 border-b border-[#E3E1DB] space-y-2.5 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4 md:px-5 md:py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-sm font-semibold text-[#131210] whitespace-nowrap">SMS Campaigns</h3>
                  <span className="hidden sm:inline text-[10px] font-medium text-[#9B9890] bg-[#F7F6F3] border border-[#E3E1DB] px-1.5 py-0.5 rounded whitespace-nowrap">Bulk SMS to contact lists</span>
                </div>
                <button
                  data-tour="new-campaign-btn"
                  onClick={() => setShowCreateCampaign(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <i className="fas fa-plus text-xs"></i>
                  <span className="hidden sm:inline">New Campaign</span>
                  <span className="sm:hidden">New</span>
                </button>
              </div>
              <div className="flex items-center gap-2 md:flex-1 md:max-w-sm md:ml-3">
                <div className="relative flex-1">
                  <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                  <input
                    type="text"
                    placeholder="Search…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="shrink-0 px-2.5 py-1.5 border border-[#E3E1DB] rounded-md text-sm text-[#5C5A55] focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            {paginatedCampaigns.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-[#9B9890]">No SMS campaigns found</p>
                <p className="text-xs text-[#9B9890] mt-1">
                  {campaigns.length === 0 ? 'Create your first SMS campaign to start sending bulk messages' : 'Try adjusting your filters'}
                </p>
              </div>
            ) : (
              <>
                <div className="md:hidden divide-y divide-[#E3E1DB]">
                  {paginatedCampaigns.map((campaign) => {
                    const status = getStatusBadge(campaign)
                    return (
                      <div key={campaign.id} className="px-4 py-3.5 active:bg-[#F7F6F3] cursor-pointer" onClick={() => { setSelectedCampaign(campaign); setShowViewCampaign(true) }}>
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <p className="text-sm font-semibold text-[#131210] leading-snug flex-1 min-w-0">{campaign.name}</p>
                          <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>{status.label}</span>
                        </div>
                        <p className="text-xs text-[#9B9890] truncate mb-2">{campaign.message_template}</p>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 text-xs text-[#9B9890] min-w-0">
                            <span className="flex items-center gap-1 min-w-0">
                              <i className="fas fa-users text-[10px]"></i>
                              <span>{campaign.total_recipients ?? 0} recipients</span>
                            </span>
                            <span className="truncate hidden xs:block">
                              {campaign.source === 'monday'
                                ? (campaign.monday_board_name || 'Monday board')
                                : (campaign.contact_list_names?.join(', ') || '—')}
                            </span>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button title="View" onClick={(e) => { e.stopPropagation(); setSelectedCampaign(campaign); setShowViewCampaign(true) }} className="p-2 text-[#9B9890] hover:text-[#5C5A55] rounded-lg transition-colors"><i className="fas fa-eye text-xs"></i></button>
                            <button title={campaign.status === 'paused' ? 'Resume' : 'Pause'} onClick={(e) => { e.stopPropagation(); handlePauseCampaign(campaign.id, campaign.status === 'paused') }} className="p-2 text-[#9B9890] hover:text-yellow-600 rounded-lg transition-colors"><i className={`fas ${campaign.status === 'paused' ? 'fa-play' : 'fa-pause'} text-xs`}></i></button>
                            <button title="Delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ campaignId: campaign.id, campaignName: campaign.name }) }} className="p-2 text-[#9B9890] hover:text-[#D63B1F] rounded-lg transition-colors"><i className="fas fa-trash text-xs"></i></button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Campaign</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Status</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Contact List</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Recipients</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Created</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3E1DB]">
                      {paginatedCampaigns.map((campaign) => {
                        const status = getStatusBadge(campaign)
                        return (
                          <tr key={campaign.id} className="hover:bg-[#F7F6F3] cursor-pointer" onClick={() => { setSelectedCampaign(campaign); setShowViewCampaign(true) }}>
                            <td className="px-5 py-3">
                              <p className="text-sm font-medium text-[#131210]">{campaign.name}</p>
                              <p className="text-xs text-[#9B9890] truncate max-w-xs mt-0.5">{campaign.message_template}</p>
                            </td>
                            <td className="px-5 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>{status.label}</span></td>
                            <td className="px-5 py-3 text-sm text-[#5C5A55]">
                              {campaign.source === 'monday' ? (
                                <span className="inline-flex items-center gap-1.5">
                                  {campaign.monday_board_name || 'Monday board'}
                                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9890] bg-[#EFEDE8] px-1.5 py-0.5 rounded">Monday</span>
                                </span>
                              ) : (campaign.contact_list_names?.join(', ') || 'Unknown')}
                            </td>
                            <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.total_recipients ?? 0}</td>
                            <td className="px-5 py-3 text-sm text-[#9B9890] whitespace-nowrap">{formatDate(campaign.created_at)}</td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button title="View" onClick={(e) => { e.stopPropagation(); setSelectedCampaign(campaign); setShowViewCampaign(true) }} className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"><i className="fas fa-eye text-[13px]"></i></button>
                                <button title={campaign.status === 'paused' ? 'Resume' : 'Pause'} onClick={(e) => { e.stopPropagation(); handlePauseCampaign(campaign.id, campaign.status === 'paused') }} className="p-1.5 text-[#9B9890] hover:text-yellow-600 hover:bg-yellow-50 rounded transition-colors"><i className={`fas ${campaign.status === 'paused' ? 'fa-play' : 'fa-pause'} text-[13px]`}></i></button>
                                <button title={campaign.status === 'archived' ? 'Unarchive' : 'Archive'} onClick={(e) => { e.stopPropagation(); handleArchiveCampaign(campaign.id, campaign.status === 'archived') }} className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"><i className="fas fa-archive text-[13px]"></i></button>
                                <button title="Delete" onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ campaignId: campaign.id, campaignName: campaign.name }) }} className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"><i className="fas fa-trash text-[13px]"></i></button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
                    <p className="text-xs text-[#9B9890]">{(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredCampaigns.length)} of {filteredCampaigns.length}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-left"></i></button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button key={page} onClick={() => setCurrentPage(page)} className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${currentPage === page ? 'bg-[#D63B1F] text-white border-[#D63B1F]' : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>{page}</button>
                      ))}
                      <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-right"></i></button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── RVM Section ── */}
        {activeTab === 'rvm' && (
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E3E1DB] space-y-2.5 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4 md:px-5 md:py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-sm font-semibold text-[#131210] whitespace-nowrap">RVM Campaigns</h3>
                  <span className="hidden sm:inline text-[10px] font-medium text-[#9B9890] bg-[#F7F6F3] border border-[#E3E1DB] px-1.5 py-0.5 rounded whitespace-nowrap">Ringless voicemail</span>
                </div>
                <button
                  onClick={() => setShowCreateRVM(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <i className="fas fa-plus text-xs"></i>
                  <span className="hidden sm:inline">New RVM Campaign</span>
                  <span className="sm:hidden">New</span>
                </button>
              </div>
              <div className="flex items-center gap-2 md:flex-1 md:max-w-sm md:ml-3">
                <div className="relative flex-1">
                  <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                  <input
                    type="text"
                    placeholder="Search…"
                    value={rvmSearchTerm}
                    onChange={(e) => setRvmSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  />
                </div>
                <select
                  value={rvmStatusFilter}
                  onChange={(e) => setRvmStatusFilter(e.target.value)}
                  className="shrink-0 px-2.5 py-1.5 border border-[#E3E1DB] rounded-md text-sm text-[#5C5A55] focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>

            {paginatedRVMCampaigns.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="w-10 h-10 bg-[#F7F6F3] rounded-full flex items-center justify-center mx-auto mb-3">
                  <i className="fas fa-voicemail text-[#9B9890]"></i>
                </div>
                <p className="text-sm text-[#9B9890]">No RVM campaigns found</p>
                <p className="text-xs text-[#9B9890] mt-1">
                  {rvmCampaigns.length === 0 ? 'Create your first ringless voicemail campaign' : 'Try adjusting your filters'}
                </p>
                {rvmCampaigns.length === 0 && (
                  <button onClick={() => setShowCreateRVM(true)} className="mt-3 px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md transition-colors">
                    Create RVM Campaign
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="md:hidden divide-y divide-[#E3E1DB]">
                  {paginatedRVMCampaigns.map((campaign) => {
                    const status = getStatusBadge(campaign)
                    return (
                      <div key={campaign.id} className="px-4 py-3.5 active:bg-[#F7F6F3] cursor-pointer" onClick={() => { setSelectedRVMCampaign(campaign); setShowViewRVM(true) }}>
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <p className="text-sm font-semibold text-[#131210] leading-snug flex-1 min-w-0">{campaign.name}</p>
                          <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>{status.label}</span>
                        </div>
                        <p className="text-xs text-[#9B9890] mb-2">{campaign.sender_number}</p>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 text-xs text-[#9B9890]">
                            <span><i className="fas fa-paper-plane text-[10px] mr-1"></i>{campaign.sent_count ?? 0} sent</span>
                            <span><i className="fas fa-check-circle text-[10px] mr-1"></i>{campaign.delivered_count ?? 0} delivered</span>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button title="View" onClick={(e) => { e.stopPropagation(); setSelectedRVMCampaign(campaign); setShowViewRVM(true) }} className="p-2 text-[#9B9890] hover:text-[#5C5A55] rounded-lg transition-colors"><i className="fas fa-eye text-xs"></i></button>
                            <button title="Delete" onClick={(e) => { e.stopPropagation(); setRvmDeleteConfirm({ campaignId: campaign.id, campaignName: campaign.name }) }} className="p-2 text-[#9B9890] hover:text-[#D63B1F] rounded-lg transition-colors"><i className="fas fa-trash text-xs"></i></button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Campaign</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Status</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Sender</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Sent</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Delivered</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Failed</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Created</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3E1DB]">
                      {paginatedRVMCampaigns.map((campaign) => {
                        const status = getStatusBadge(campaign)
                        return (
                          <tr key={campaign.id} className="hover:bg-[#F7F6F3] cursor-pointer" onClick={() => { setSelectedRVMCampaign(campaign); setShowViewRVM(true) }}>
                            <td className="px-5 py-3">
                              <p className="text-sm font-medium text-[#131210]">{campaign.name}</p>
                              <p className="text-xs text-[#9B9890] mt-0.5">{getContactListName(campaign.contact_list_ids)}</p>
                            </td>
                            <td className="px-5 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>{status.label}</span></td>
                            <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.sender_number}</td>
                            <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.sent_count ?? 0}</td>
                            <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.delivered_count ?? 0}</td>
                            <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.failed_count ?? 0}</td>
                            <td className="px-5 py-3 text-sm text-[#9B9890] whitespace-nowrap">{formatDate(campaign.created_at)}</td>
                            <td className="px-5 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button title="View" onClick={(e) => { e.stopPropagation(); setSelectedRVMCampaign(campaign); setShowViewRVM(true) }} className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"><i className="fas fa-eye text-[13px]"></i></button>
                                <button title="Delete" onClick={(e) => { e.stopPropagation(); setRvmDeleteConfirm({ campaignId: campaign.id, campaignName: campaign.name }) }} className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"><i className="fas fa-trash text-[13px]"></i></button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {totalRVMPages > 1 && (
                  <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
                    <p className="text-xs text-[#9B9890]">{(rvmCurrentPage - 1) * itemsPerPage + 1}–{Math.min(rvmCurrentPage * itemsPerPage, filteredRVMCampaigns.length)} of {filteredRVMCampaigns.length}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setRvmCurrentPage((p) => Math.max(1, p - 1))} disabled={rvmCurrentPage === 1} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-left"></i></button>
                      {Array.from({ length: totalRVMPages }, (_, i) => i + 1).map((page) => (
                        <button key={page} onClick={() => setRvmCurrentPage(page)} className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${rvmCurrentPage === page ? 'bg-[#D63B1F] text-white border-[#D63B1F]' : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>{page}</button>
                      ))}
                      <button onClick={() => setRvmCurrentPage((p) => Math.min(totalRVMPages, p + 1))} disabled={rvmCurrentPage === totalRVMPages} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-right"></i></button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {showCreateCampaign && (
        <CreateCampaignModal
          contactLists={contactLists}
          phoneNumbers={phoneNumbers}
          subscription={subscription}
          creditBalance={creditBalance}
          onClose={() => setShowCreateCampaign(false)}
          onCampaignCreated={() => { setShowCreateCampaign(false); fetchCampaigns() }}
        />
      )}

      {showViewCampaign && selectedCampaign && (
        <ViewCampaignModal
          campaign={selectedCampaign}
          contactLists={contactLists}
          phoneNumbers={phoneNumbers}
          isTrial={subscription?.status === 'trialing'}
          onClose={() => { setShowViewCampaign(false); setSelectedCampaign(null) }}
          onCampaignUpdated={() => fetchCampaigns()}
          onLaunch={() => handleLaunchCampaign(selectedCampaign.id)}
          onPause={() => handlePauseCampaign(selectedCampaign.id, selectedCampaign.status === 'paused')}
          onArchive={() => handleArchiveCampaign(selectedCampaign.id, selectedCampaign.status === 'archived')}
          onDelete={() => setDeleteConfirm({ campaignId: selectedCampaign.id, campaignName: selectedCampaign.name })}
        />
      )}

      {showTrialUpsell && (
        <TrialUpsellModal
          subscription={subscription}
          onClose={() => setShowTrialUpsell(false)}
          onActivated={() => { setShowTrialUpsell(false); setSubscription(s => ({ ...s, status: 'active' })) }}
          user={user}
        />
      )}

      {showCreateRVM && (
        <CreateRVMCampaignModal
          contactLists={contactLists}
          phoneNumbers={phoneNumbers}
          subscription={subscription}
          creditBalance={creditBalance}
          onClose={() => setShowCreateRVM(false)}
          onCreated={() => { setShowCreateRVM(false); fetchRVMCampaigns() }}
        />
      )}

      {showViewRVM && selectedRVMCampaign && (
        <ViewRVMCampaignModal
          campaign={selectedRVMCampaign}
          contactLists={contactLists}
          onClose={() => { setShowViewRVM(false); setSelectedRVMCampaign(null) }}
          onLaunch={() => handleLaunchRVMCampaign(selectedRVMCampaign.id)}
          onDelete={() => setRvmDeleteConfirm({ campaignId: selectedRVMCampaign.id, campaignName: selectedRVMCampaign.name })}
        />
      )}

      {errorModal && (
        <ErrorModal title={errorModal.title} message={errorModal.message} onClose={() => setErrorModal(null)} />
      )}

      {deleteConfirm && (
        <DeleteConfirmationModal
          campaignName={deleteConfirm.campaignName}
          onConfirm={() => handleDeleteCampaign(deleteConfirm.campaignId)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {rvmDeleteConfirm && (
        <DeleteConfirmationModal
          campaignName={rvmDeleteConfirm.campaignName}
          onConfirm={() => handleDeleteRVMCampaign(rvmDeleteConfirm.campaignId)}
          onCancel={() => setRvmDeleteConfirm(null)}
        />
      )}
    </div>
  )
}

function CreateCampaignModal({ contactLists, phoneNumbers, subscription, creditBalance = 0, onClose, onCampaignCreated }) {
  const [formData, setFormData] = useState({
    name: '', message: '', contactListId: '', phoneNumberId: '',
    scheduleTime: '', scheduleType: 'immediate',
    // Phase 2 — Monday source
    source: 'contacts',          // 'contacts' | 'monday'
    mondayBoardId: '', mondayBoardName: '',
    mondayGroupIds: [],          // empty array == "all groups"
    mondayPhoneColumnId: '',
    mondayItemIds: [],           // selected rows; all-selected == "all items"
    mondayFilters: [],           // [{ columnId, values: [] }] — AND across, OR within
  })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [created, setCreated] = useState(false)
  const [step, setStep] = useState(1)        // 4-step wizard: 1 Basics → 4 Review
  const messageRef = useRef(null)

  // Monday integration state
  const [mondayConnected, setMondayConnected] = useState(false)
  const [mondayBoards, setMondayBoards] = useState([])
  const [mondayGroups, setMondayGroups] = useState([])
  const [mondayColumns, setMondayColumns] = useState([])
  const [mondayItems, setMondayItems] = useState([])
  const [mondayItemSearch, setMondayItemSearch] = useState('')
  const [mondayLoading, setMondayLoading] = useState({ boards: false, groups: false, columns: false, items: false })

  // Fetch connection status on mount — gates whether the Monday source option is shown.
  useEffect(() => {
    let alive = true
    fetchWithWorkspace('/api/integrations/monday')
      .then(r => r.json())
      .then(d => { if (alive) setMondayConnected(!!d?.connected) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Prefetch boards as soon as we know Monday is connected — don't wait for the
  // user to toggle the source. Monday's API is slow (~1-2s); overlapping the
  // fetch with the user filling in name/message means boards are usually ready
  // by the time they click "Monday board".
  useEffect(() => {
    if (!mondayConnected || mondayBoards.length > 0) return
    setMondayLoading(p => ({ ...p, boards: true }))
    fetchWithWorkspace('/api/integrations/monday/boards')
      .then(r => r.json())
      .then(d => setMondayBoards(d?.boards || []))
      .catch(() => setMondayBoards([]))
      .finally(() => setMondayLoading(p => ({ ...p, boards: false })))
  }, [mondayConnected, mondayBoards.length])

  // Fetch groups + columns when a board is selected. Reset both first so
  // a flicker of stale data from a previously-picked board can't slip through.
  useEffect(() => {
    if (!formData.mondayBoardId) {
      setMondayGroups([]); setMondayColumns([])
      return
    }
    setMondayLoading(p => ({ ...p, groups: true, columns: true }))
    setMondayGroups([]); setMondayColumns([])
    Promise.all([
      fetchWithWorkspace(`/api/integrations/monday/boards/${formData.mondayBoardId}/groups`).then(r => r.json()),
      fetchWithWorkspace(`/api/integrations/monday/boards/${formData.mondayBoardId}/columns`).then(r => r.json()),
    ])
      .then(([gData, cData]) => {
        const cols = cData?.columns || []
        setMondayGroups(gData?.groups || [])
        setMondayColumns(cols)
        // Auto-select the first `phone` type column if user hasn't picked one yet.
        const phoneCol = cols.find(c => c.isPhoneType)
        if (phoneCol && !formData.mondayPhoneColumnId) {
          setFormData(f => ({ ...f, mondayPhoneColumnId: phoneCol.id }))
        }
      })
      .catch(() => { setMondayGroups([]); setMondayColumns([]) })
      .finally(() => setMondayLoading(p => ({ ...p, groups: false, columns: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.mondayBoardId])

  // Fetch the board's items (rows) once board, groups and phone column are set,
  // so the user can pick which rows to send to. Default selection = all rows.
  // Re-runs when the group filter changes (different groups → different rows).
  useEffect(() => {
    if (formData.source !== 'monday' || !formData.mondayBoardId || !formData.mondayPhoneColumnId) {
      setMondayItems([])
      return
    }
    setMondayLoading(p => ({ ...p, items: true }))
    setMondayItemSearch('')
    const qs = new URLSearchParams()
    if (formData.mondayGroupIds.length > 0) qs.set('groups', formData.mondayGroupIds.join(','))
    qs.set('phone_column_id', formData.mondayPhoneColumnId)
    fetchWithWorkspace(`/api/integrations/monday/boards/${formData.mondayBoardId}/items?${qs}`)
      .then(r => r.json())
      .then(d => {
        const items = d?.items || []
        setMondayItems(items)
        setFormData(f => ({
          ...f,
          mondayItemIds: items.map(i => i.id),
          mondayFilters: [],
        }))
      })
      .catch(() => { setMondayItems([]); setFormData(f => ({ ...f, mondayItemIds: [] })) })
      .finally(() => setMondayLoading(p => ({ ...p, items: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.source, formData.mondayBoardId, formData.mondayGroupIds.join(','), formData.mondayPhoneColumnId])

  const insertPlaceholder = (tag) => {
    const ta = messageRef.current
    const current = formData.message || ''
    if (!ta || typeof ta.selectionStart !== 'number') {
      setFormData(f => ({ ...f, message: (f.message || '') + tag }))
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = current.slice(0, start) + tag + current.slice(end)
    setFormData(f => ({ ...f, message: next }))
    requestAnimationFrame(() => {
      const node = messageRef.current
      if (!node) return
      const pos = start + tag.length
      node.focus()
      node.setSelectionRange(pos, pos)
    })
  }

  const contactListOptions = contactLists.map(cl => ({ value: cl.id, label: cl.name, count: cl.contactCount ?? cl.contact_count ?? 0, searchText: cl.name }))
  const phoneNumberOptions = phoneNumbers.map(pn => ({ value: pn.id, number: pn.phone_number || pn.phoneNumber, name: pn.custom_name || pn.prefix || '', searchText: `${pn.custom_name || ''} ${pn.phone_number || pn.phoneNumber || ''}` }))

  // ── Monday status-column filter ─────────────────────────────────────────────
  // Lets the user narrow recipients to rows with a given status (e.g.
  // Stage = Qualified). Purely a selection helper — the result is captured in
  // mondayItemIds, so it needs no separate persistence or send-loop logic.
  // A filter with no column or no values picked is inactive (matches all).
  const matchesFilters = (it, filters) => {
    const cols = it.columns || {}
    return filters.every(f => !f.columnId || f.values.length === 0 || f.values.includes(cols[f.columnId]))
  }
  // The recipient pool — rows matching EVERY active filter.
  const recipientPool = mondayItems.filter(it => matchesFilters(it, formData.mondayFilters))

  // Distinct values present in a column, for the value picker.
  const columnValueOptions = (colId) => colId
    ? [...new Set(mondayItems.map(it => (it.columns || {})[colId]).filter(v => v && String(v).trim()))].sort()
    : []

  // Any filter change re-selects the whole matching pool (user can fine-tune after).
  const commitFilters = (nextFilters) => {
    const pool = mondayItems.filter(it => matchesFilters(it, nextFilters))
    setFormData(f => ({ ...f, mondayFilters: nextFilters, mondayItemIds: pool.map(i => i.id) }))
  }
  const addFilter = () =>
    setFormData(f => ({ ...f, mondayFilters: [...f.mondayFilters, { columnId: '', values: [] }] }))
  const removeFilter = (idx) =>
    commitFilters(formData.mondayFilters.filter((_, i) => i !== idx))
  const setFilterColumn = (idx, colId) =>
    commitFilters(formData.mondayFilters.map((f, i) => i === idx ? { columnId: colId, values: [] } : f))
  const toggleFilterValue = (idx, val) =>
    commitFilters(formData.mondayFilters.map((f, i) => {
      if (i !== idx) return f
      const values = f.values.includes(val) ? f.values.filter(v => v !== val) : [...f.values, val]
      return { ...f, values }
    }))

  const STEP_LABELS = ['Basics', 'Audience', 'Message', 'Review']

  // Validate only the fields belonging to a given wizard step.
  const validateStep = (n) => {
    const e = {}
    if (n === 1) {
      if (!formData.name.trim()) e.name = 'Campaign name is required'
      if (!formData.phoneNumberId) e.phoneNumberId = 'Sender number is required'
    } else if (n === 2) {
      if (formData.source === 'contacts') {
        if (!formData.contactListId) e.contactListId = 'Contact list is required'
      } else {
        if (!formData.mondayBoardId) e.mondayBoardId = 'Board is required'
        if (!formData.mondayPhoneColumnId) e.mondayPhoneColumnId = 'Phone number column is required'
        if (mondayItems.length > 0 && formData.mondayItemIds.length === 0) e.mondayItemIds = 'Select at least one recipient.'
      }
    } else if (n === 3) {
      if (!formData.message.trim()) e.message = 'Message is required'
    } else if (n === 4) {
      if (formData.scheduleType === 'scheduled' && !formData.scheduleTime) e.scheduleTime = 'Schedule time is required'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const goNext = () => { if (validateStep(step)) setStep(s => Math.min(4, s + 1)) }
  const goBack = () => { setErrors({}); setStep(s => Math.max(1, s - 1)) }

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Campaign name is required'
    if (!formData.message.trim()) newErrors.message = 'Message is required'
    if (formData.source === 'contacts') {
      if (!formData.contactListId) newErrors.contactListId = 'Contact list is required'
    } else {
      if (!formData.mondayBoardId) newErrors.mondayBoardId = 'Board is required'
      if (!formData.mondayPhoneColumnId) newErrors.mondayPhoneColumnId = 'Phone number column is required'
      if (mondayItems.length > 0 && formData.mondayItemIds.length === 0) {
        newErrors.mondayItemIds = 'Select at least one recipient.'
      }
    }
    if (!formData.phoneNumberId) newErrors.phoneNumberId = 'Phone number is required'
    if (formData.scheduleType === 'scheduled' && !formData.scheduleTime) newErrors.scheduleTime = 'Schedule time is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return
    setIsSubmitting(true)
    try {
      const selectedPn = phoneNumbers.find(pn => pn.id === formData.phoneNumberId)
      const senderNumber = selectedPn?.phone_number || selectedPn?.phoneNumber

      // Monday-sourced campaigns still get a (synthetic empty) contact_list_ids
      // because the column is NOT NULL in the schema. The send loop checks for
      // a campaign_monday_links row first and ignores contact_list_ids when one
      // is present.
      const payload = {
        name: formData.name,
        message_template: formData.message,
        contact_list_ids: formData.source === 'contacts' ? [formData.contactListId] : [],
        sender_number: senderNumber,
        delay_between_messages: 1000,
        // Tells the create endpoint to skip contact-list validation — a Monday
        // campaign's recipients come from the board, linked right after this.
        source: formData.source,
      }
      const response = await apiPost('/api/campaigns', payload)
      const data = await response.json()

      if (!data.success) {
        setErrors({ submit: data.error || 'Failed to create campaign' })
        return
      }

      // If Monday source, persist the link to the new campaign.
      if (formData.source === 'monday') {
        const newCampaignId = data.campaign?.id || data.id || data.campaignId
        if (!newCampaignId) {
          setErrors({ submit: 'Campaign created but ID was missing — refresh and link the board manually.' })
          return
        }
        // If every row is selected, send item_ids empty → stored as "all", so
        // rows added to the board later are still included. Otherwise lock in
        // the explicit subset the user picked.
        const allSelected =
          mondayItems.length > 0 && formData.mondayItemIds.length === mondayItems.length
        const linkRes = await fetchWithWorkspace(`/api/campaigns/${newCampaignId}/monday-link`, {
          method: 'POST',
          body: JSON.stringify({
            board_id: formData.mondayBoardId,
            board_name: formData.mondayBoardName,
            group_ids: formData.mondayGroupIds,
            item_ids: allSelected ? [] : formData.mondayItemIds,
            phone_column_id: formData.mondayPhoneColumnId,
          }),
        })
        const linkData = await linkRes.json()
        if (!linkRes.ok || !linkData.success) {
          setErrors({ submit: `Campaign created but linking the Monday board failed: ${linkData.error || 'unknown error'}` })
          return
        }
      }

      setCreated(true)
    } catch {
      setErrors({ submit: 'Failed to create campaign. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
          <div className="px-5 py-8 text-center">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fas fa-check text-green-600"></i></div>
            <h3 className="text-sm font-semibold text-[#131210] mb-1">Campaign Created</h3>
            <p className="text-xs text-[#9B9890] mb-4">Your campaign has been created successfully.</p>
            <button onClick={onCampaignCreated} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#F7F6F3] flex flex-col">
      {/* Header */}
      <header data-tour="campaign-modal-header" className="bg-[#FFFFFF] border-b border-[#E3E1DB] flex-shrink-0">
        <div className="flex items-center gap-3 px-4 sm:px-8 pt-3.5 pb-2">
          <button type="button" onClick={onClose} className="p-2 -ml-2 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded-lg transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
          <h3 className="text-base sm:text-lg font-semibold text-[#131210]">New Campaign</h3>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-1 sm:gap-2 px-4 sm:px-8 pb-3 overflow-x-auto">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1
            const active = step === n
            const done = step > n
            return (
              <div key={label} className="flex items-center gap-1 sm:gap-2 shrink-0">
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-md ${active ? 'bg-[#fdecea]' : ''}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${active ? 'bg-[#D63B1F] text-white' : done ? 'bg-[#1F8C4A] text-white' : 'bg-[#EFEDE8] text-[#9B9890]'}`}>{n}</span>
                  <span className={`text-xs font-medium ${active ? 'text-[#D63B1F]' : done ? 'text-[#5C5A55]' : 'text-[#9B9890]'}`}>{label}</span>
                </div>
                {n < 4 && <span className="w-4 sm:w-8 h-px bg-[#E3E1DB]" />}
              </div>
            )
          })}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-5">

            {/* ─── Step 1: Basics ─── */}
            {step === 1 && (
            <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-1">Basics</h4>
              <p className="text-xs text-[#9B9890] mb-4">Name your campaign and pick the number it sends from.</p>
              <div className="space-y-4">
                <div data-tour="campaign-modal-name">
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Campaign Name *</label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Summer Sale Campaign" className="w-full px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]" />
                  {errors.name && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Send from number *</label>
                  <SearchableDropdown value={formData.phoneNumberId} onChange={(v) => setFormData(f => ({ ...f, phoneNumberId: v }))} options={phoneNumberOptions} placeholder="Select a number" error={errors.phoneNumberId}
                    renderSelected={(o) => o.name ? `${o.name} — ${o.number}` : o.number}
                    renderOption={(o) => (<div>{o.name && <p className="text-sm font-medium text-[#131210]">{o.name}</p>}<p className={`text-sm ${o.name ? 'text-[#9B9890]' : 'font-medium text-[#131210]'}`}>{o.number}</p></div>)}
                  />
                  {errors.phoneNumberId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.phoneNumberId}</p>}
                </div>
              </div>
            </section>
            )}

            {/* ─── Step 2: Audience ─── */}
            {step === 2 && (
            <section data-tour="campaign-modal-settings" className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-4">Audience</h4>

              {/* Source toggle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData(f => ({ ...f, source: 'contacts' }))}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border text-left transition-colors ${formData.source === 'contacts' ? 'bg-[#fdecea] border-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}
                >
                  <i className={`fas fa-address-book mt-0.5 ${formData.source === 'contacts' ? 'text-[#D63B1F]' : 'text-[#9B9890]'}`} />
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${formData.source === 'contacts' ? 'text-[#D63B1F]' : 'text-[#131210]'}`}>Contacts list</span>
                    <span className="block text-xs text-[#9B9890] mt-0.5">Send to one of your saved lists</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => mondayConnected && setFormData(f => ({ ...f, source: 'monday' }))}
                  disabled={!mondayConnected}
                  title={mondayConnected ? '' : 'Connect Monday.com in Settings → Integrations first'}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border text-left transition-colors ${formData.source === 'monday' ? 'bg-[#fdecea] border-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] hover:bg-[#F7F6F3]'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#FFFFFF]`}
                >
                  <svg width="18" height="18" viewBox="0 0 32 32" fill="none" className="mt-0.5 shrink-0">
                    <circle cx="6" cy="16" r="5" fill="#FF3D57" />
                    <circle cx="16" cy="16" r="5" fill="#FFCB00" />
                    <circle cx="26" cy="16" r="5" fill="#00CA72" />
                  </svg>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${formData.source === 'monday' ? 'text-[#D63B1F]' : 'text-[#131210]'}`}>Monday board</span>
                    <span className="block text-xs text-[#9B9890] mt-0.5">Send from a Monday.com board</span>
                  </span>
                </button>
              </div>
              {!mondayConnected && (
                <p className="text-[11px] text-[#9B9890] mt-2">
                  Connect <a href="/settings?section=integrations" className="text-[#D63B1F] hover:underline">Monday.com</a> to send campaigns from a board.
                </p>
              )}

              <div className="mt-5">
              {formData.source === 'contacts' ? (
              <div>
                <label className="block text-sm font-medium text-[#5C5A55] mb-2">Contact List *</label>
                <SearchableDropdown value={formData.contactListId} onChange={(v) => setFormData(f => ({ ...f, contactListId: v }))} options={contactListOptions} placeholder="Select a list" error={errors.contactListId}
                  renderSelected={(o) => o.label}
                  renderOption={(o) => (<div><p className="text-sm font-medium text-[#131210]">{o.label}</p><p className="text-xs text-[#9B9890] mt-0.5">{o.count} contacts</p></div>)}
                />
                {errors.contactListId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.contactListId}</p>}
              </div>
            ) : (
              <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Board picker */}
                <div>
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Board *</label>
                  <SearchableDropdown
                    value={formData.mondayBoardId}
                    onChange={(v) => {
                      const board = mondayBoards.find(b => String(b.id) === String(v))
                      setFormData(f => ({
                        ...f,
                        mondayBoardId: v,
                        mondayBoardName: board?.name || '',
                        mondayGroupIds: [],
                        mondayPhoneColumnId: '',
                      }))
                    }}
                    options={mondayBoards.map(b => ({ value: String(b.id), label: b.name, count: b.items_count || 0, searchText: b.name }))}
                    placeholder={mondayLoading.boards ? 'Loading boards…' : (mondayBoards.length === 0 ? 'No boards found' : 'Select a board')}
                    loading={mondayLoading.boards}
                    error={errors.mondayBoardId}
                    renderSelected={(o) => o.label}
                    renderOption={(o) => (<div><p className="text-sm font-medium text-[#131210]">{o.label}</p><p className="text-xs text-[#9B9890] mt-0.5">{o.count} items</p></div>)}
                  />
                  {errors.mondayBoardId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.mondayBoardId}</p>}
                </div>

                {/* Phone column picker */}
                {formData.mondayBoardId && (
                  <div>
                    <label className="block text-sm font-medium text-[#5C5A55] mb-2">Phone Number Column *</label>
                    <SearchableDropdown
                      value={formData.mondayPhoneColumnId}
                      onChange={(v) => setFormData(f => ({ ...f, mondayPhoneColumnId: v }))}
                      options={mondayColumns.map(c => ({
                        value: c.id,
                        label: c.title,
                        type: c.type,
                        searchText: `${c.title} ${c.type}`,
                      }))}
                      placeholder={mondayLoading.columns ? 'Loading columns…' : 'Select the phone column'}
                      loading={mondayLoading.columns}
                      error={errors.mondayPhoneColumnId}
                      renderSelected={(o) => o.label}
                      renderOption={(o) => (
                        <div>
                          <p className="text-sm font-medium text-[#131210]">{o.label}</p>
                          <p className="text-xs text-[#9B9890] mt-0.5 font-mono">{o.type}</p>
                        </div>
                      )}
                    />
                    {errors.mondayPhoneColumnId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.mondayPhoneColumnId}</p>}
                    <p className="text-[11px] text-[#9B9890] mt-1.5">Items missing a phone in this column will be skipped at send time.</p>
                  </div>
                )}
              </div>

              {/* Groups multi-select — empty selection means "all groups" */}
              {formData.mondayBoardId && (
                <div>
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Groups</label>
                  {mondayLoading.groups ? (
                    <p className="text-xs text-[#9B9890]">Loading groups…</p>
                  ) : mondayGroups.length === 0 ? (
                    <p className="text-xs text-[#9B9890]">No groups on this board.</p>
                  ) : (
                    <div className="border border-[#E3E1DB] rounded-lg max-h-44 overflow-y-auto divide-y divide-[#F0EEE9]">
                      <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3] transition-colors">
                        <input
                          type="checkbox"
                          checked={formData.mondayGroupIds.length === 0}
                          onChange={() => setFormData(f => ({ ...f, mondayGroupIds: [] }))}
                          className="accent-[#D63B1F]"
                        />
                        <span className="text-sm font-medium text-[#131210]">All groups</span>
                      </label>
                      {mondayGroups.map(g => (
                        <label key={g.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3] transition-colors">
                          <input
                            type="checkbox"
                            checked={formData.mondayGroupIds.includes(g.id)}
                            onChange={(e) => {
                              setFormData(f => {
                                const next = e.target.checked
                                  ? [...f.mondayGroupIds, g.id]
                                  : f.mondayGroupIds.filter(x => x !== g.id)
                                return { ...f, mondayGroupIds: next }
                              })
                            }}
                            className="accent-[#D63B1F]"
                          />
                          <span className="text-sm text-[#131210]">{g.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Recipient (row) picker — choose which Monday items to send to */}
                {formData.mondayBoardId && formData.mondayPhoneColumnId && (
                  <div>
                    <label className="block text-sm font-medium text-[#5C5A55] mb-2">
                      Recipients
                      {mondayItems.length > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-[#9B9890]">
                          {formData.mondayItemIds.length} of {recipientPool.length} selected
                        </span>
                      )}
                    </label>
                    {mondayLoading.items ? (
                      <p className="text-xs text-[#9B9890]">Loading items…</p>
                    ) : mondayItems.length === 0 ? (
                      <p className="text-xs text-[#9B9890]">No items in the selected group(s).</p>
                    ) : (
                      <>
                        {/* Multi-column filters — AND across columns, OR within values */}
                        {mondayColumns.length > 0 && (
                          <div className="mb-3 p-3 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3]">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-xs font-medium text-[#5C5A55]">Filters</span>
                              <button type="button" onClick={addFilter} className="text-[11px] text-[#D63B1F] hover:underline">
                                + Add filter
                              </button>
                            </div>
                            {formData.mondayFilters.length === 0 ? (
                              <p className="text-[11px] text-[#9B9890]">No filters — all rows included.</p>
                            ) : (
                              <div className="space-y-2">
                                {formData.mondayFilters.map((flt, idx) => {
                                  const vals = columnValueOptions(flt.columnId)
                                  return (
                                    <div key={idx} className="p-2 bg-[#FFFFFF] border border-[#E3E1DB] rounded-md">
                                      <div className="flex items-center gap-2">
                                        <select
                                          value={flt.columnId}
                                          onChange={(e) => setFilterColumn(idx, e.target.value)}
                                          className="flex-1 min-w-0 px-2 py-1.5 border border-[#D4D1C9] rounded text-xs bg-[#FFFFFF] focus:outline-none focus:border-[#D63B1F]"
                                        >
                                          <option value="">Choose a column…</option>
                                          {mondayColumns.map(c => (
                                            <option key={c.id} value={c.id}>{c.title}</option>
                                          ))}
                                        </select>
                                        <button type="button" onClick={() => removeFilter(idx)} title="Remove filter" className="shrink-0 text-[#9B9890] hover:text-[#D63B1F] p-1">
                                          <i className="fas fa-times text-xs" />
                                        </button>
                                      </div>
                                      {flt.columnId && (
                                        vals.length === 0 ? (
                                          <p className="text-[11px] text-[#9B9890] mt-1.5">No values in this column.</p>
                                        ) : (
                                          <div className="flex flex-wrap gap-1.5 mt-2">
                                            {vals.map(val => {
                                              const on = flt.values.includes(val)
                                              return (
                                                <button key={val} type="button" onClick={() => toggleFilterValue(idx, val)}
                                                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${on ? 'bg-[#fdecea] border-[#D63B1F] text-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] text-[#5C5A55] hover:bg-[#EFEDE8]'}`}>
                                                  {val}
                                                </button>
                                              )
                                            })}
                                          </div>
                                        )
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        <input
                          type="text"
                          value={mondayItemSearch}
                          onChange={(e) => setMondayItemSearch(e.target.value)}
                          placeholder="Search items…"
                          className="w-full mb-2 px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                        />
                        {recipientPool.length === 0 ? (
                          <p className="text-xs text-[#9B9890]">No rows match this status filter.</p>
                        ) : (
                        <div className="border border-[#E3E1DB] rounded-lg max-h-60 overflow-y-auto divide-y divide-[#F0EEE9]">
                          <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3] sticky top-0 bg-[#FFFFFF] border-b border-[#E3E1DB]">
                            <input
                              type="checkbox"
                              checked={recipientPool.length > 0 && formData.mondayItemIds.length === recipientPool.length}
                              ref={el => { if (el) el.indeterminate = formData.mondayItemIds.length > 0 && formData.mondayItemIds.length < recipientPool.length }}
                              onChange={(e) => {
                                setFormData(f => ({ ...f, mondayItemIds: e.target.checked ? recipientPool.map(i => i.id) : [] }))
                              }}
                              className="accent-[#D63B1F]"
                            />
                            <span className="text-sm font-medium text-[#131210]">Select all</span>
                          </label>
                          {recipientPool
                            .filter(it => {
                              const q = mondayItemSearch.trim().toLowerCase()
                              if (!q) return true
                              return (it.name || '').toLowerCase().includes(q) || (it.phone || '').toLowerCase().includes(q)
                            })
                            .map(it => (
                              <label key={it.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3]">
                                <input
                                  type="checkbox"
                                  checked={formData.mondayItemIds.includes(it.id)}
                                  onChange={(e) => {
                                    setFormData(f => {
                                      const next = e.target.checked
                                        ? [...f.mondayItemIds, it.id]
                                        : f.mondayItemIds.filter(x => x !== it.id)
                                      return { ...f, mondayItemIds: next }
                                    })
                                  }}
                                  className="accent-[#D63B1F] shrink-0"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm text-[#131210] truncate">{it.name}</span>
                                  {it.phone
                                    ? <span className="block text-xs text-[#9B9890] font-mono truncate">{it.phone}</span>
                                    : <span className="block text-xs text-[#D63B1F]">No phone — will be skipped</span>}
                                </span>
                              </label>
                            ))}
                        </div>
                        )}
                        {errors.mondayItemIds && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.mondayItemIds}</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
              </div>
            </section>
            )}

            {/* ─── Step 3: Message ─── */}
            {step === 3 && (
            <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-1">Message</h4>
              <p className="text-xs text-[#9B9890] mb-4">Write the SMS. Use placeholders to personalize each message.</p>
              <div data-tour="campaign-modal-message">
                <label className="block text-sm font-medium text-[#5C5A55] mb-2">Message *</label>
                <textarea ref={messageRef} value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} placeholder="Type your SMS message here…" rows={6} className="w-full px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F] resize-y min-h-[140px]" />
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className="text-xs text-[#9B9890] font-medium">Insert placeholder:</span>
                  {formData.source === 'monday' ? (
                    mondayColumns.filter(c => c.placeholder).length === 0 ? (
                      <span className="text-xs text-[#9B9890] italic">Pick a board to see available columns</span>
                    ) : (
                      mondayColumns
                        .filter(c => c.placeholder)
                        .filter((c, i, arr) => arr.findIndex(x => x.placeholder === c.placeholder) === i)
                        .map(c => {
                          const tag = `{{${c.placeholder}}}`
                          return (
                            <button key={c.id} type="button" onClick={() => insertPlaceholder(tag)} title={`${c.title} (${c.type})`} className="px-2.5 py-1 text-xs bg-[#EFEDE8] hover:bg-[#fdecea] hover:text-[#D63B1F] hover:border-[#D63B1F] text-[#5C5A55] rounded-md border border-[#E3E1DB] font-mono transition-colors">{tag}</button>
                          )
                        })
                    )
                  ) : (
                    ['{first_name}', '{last_name}', '{business_name}', '{email}', '{phone}', '{city}', '{state}', '{country}'].map(tag => (
                      <button key={tag} type="button" onClick={() => insertPlaceholder(tag)} className="px-2.5 py-1 text-xs bg-[#EFEDE8] hover:bg-[#fdecea] hover:text-[#D63B1F] hover:border-[#D63B1F] text-[#5C5A55] rounded-md border border-[#E3E1DB] font-mono transition-colors">{tag}</button>
                    ))
                  )}
                </div>
                {errors.message && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.message}</p>}
              </div>
            </section>
            )}

            {/* ─── Step 4: Review & send ─── */}
            {step === 4 && (
            <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-1">Review &amp; send</h4>
              <p className="text-xs text-[#9B9890] mb-4">Check the details, then send now or schedule for later.</p>

              {(() => {
                const list = contactListOptions.find(o => o.value === formData.contactListId)
                const pn = phoneNumberOptions.find(o => o.value === formData.phoneNumberId)
                const audienceLabel = formData.source === 'monday'
                  ? `Monday — ${formData.mondayBoardName || 'board'}`
                  : (list?.label || '—')
                const recipientCount = formData.source === 'monday'
                  ? formData.mondayItemIds.length
                  : (list?.count ?? 0)
                const rows = [
                  ['Campaign', formData.name || '—'],
                  ['Audience', audienceLabel],
                  ['Recipients', String(recipientCount)],
                  ['Sends from', pn ? (pn.name ? `${pn.name} — ${pn.number}` : pn.number) : '—'],
                ]
                // Resolved recipient list (Monday path — the picked rows).
                const previewItems = formData.source === 'monday'
                  ? mondayItems.filter(it => formData.mondayItemIds.includes(it.id))
                  : []
                const PREVIEW_CAP = 50
                return (
                  <>
                  <div className="border border-[#E3E1DB] rounded-lg divide-y divide-[#F0EEE9] mb-4">
                    {rows.map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
                        <span className="text-xs text-[#9B9890] uppercase tracking-wider">{k}</span>
                        <span className="text-sm text-[#131210] text-right">{v}</span>
                      </div>
                    ))}
                    <div className="px-4 py-2.5">
                      <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Message</p>
                      <p className="text-sm text-[#5C5A55] whitespace-pre-wrap">{formData.message || '—'}</p>
                    </div>
                  </div>

                  {/* ─── Campaign cost (1 credit / SMS → dollar value) ─── */}
                  {recipientCount > 0 && (() => {
                    const credits = recipientCount * 1   // 1 credit per SMS
                    const plan = PLAN_OVERAGE[subscription?.plan_name] || DEFAULT_OVERAGE
                    const balance = Number(creditBalance || 0)
                    const dollarValue = credits * plan.rate
                    const overageCredits = Math.max(0, credits - balance)
                    const leftAfter = Math.max(0, balance - credits)
                    const usd = (n) => `$${n.toFixed(2)}`
                    return (
                      <div className="bg-[#131210] text-white rounded-lg p-4 mb-4">
                        <div className="flex items-end justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1">Campaign cost</p>
                            <p className="text-2xl font-semibold leading-none">
                              {credits.toLocaleString()} <span className="text-base font-normal text-white/60">credits</span>
                            </p>
                            <p className="text-[11px] text-white/50 mt-1">{recipientCount.toLocaleString()} message{recipientCount === 1 ? '' : 's'} × 1 credit</p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-semibold leading-none text-[#FF7A5C]">{usd(dollarValue)}</p>
                            <p className="text-[11px] text-white/50 mt-1">≈ at ${plan.rate.toFixed(2)}/credit · {plan.name}</p>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-white/10 text-[11px] text-white/70 leading-relaxed">
                          {overageCredits === 0
                            ? <>Uses <strong className="text-white">{credits.toLocaleString()}</strong> of your <strong className="text-white">{balance.toLocaleString()}</strong> credits — <strong className="text-white">{leftAfter.toLocaleString()}</strong> left after this send.</>
                            : <>Your balance is <strong className="text-white">{balance.toLocaleString()}</strong> — <strong className="text-[#FF7A5C]">{overageCredits.toLocaleString()} short</strong>. Top up before launching.</>}
                        </div>
                      </div>
                    )
                  })()}

                  {formData.source === 'monday' && (
                    <div className="mb-4">
                      <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1.5">
                        Will send to {previewItems.length} recipient{previewItems.length !== 1 ? 's' : ''}
                      </p>
                      {previewItems.length === 0 ? (
                        <p className="text-xs text-[#D63B1F]">No recipients selected — go back to step 2.</p>
                      ) : (
                        <div className="border border-[#E3E1DB] rounded-lg max-h-52 overflow-y-auto divide-y divide-[#F0EEE9]">
                          {previewItems.slice(0, PREVIEW_CAP).map(it => (
                            <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2">
                              <span className="text-sm text-[#131210] truncate">{it.name}</span>
                              <span className={`text-xs font-mono shrink-0 ${it.phone ? 'text-[#9B9890]' : 'text-[#D63B1F]'}`}>
                                {it.phone || 'no phone — skipped'}
                              </span>
                            </div>
                          ))}
                          {previewItems.length > PREVIEW_CAP && (
                            <div className="px-3 py-2 text-xs text-[#9B9890] text-center">
                              + {previewItems.length - PREVIEW_CAP} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  </>
                )
              })()}

              <label className="block text-sm font-medium text-[#5C5A55] mb-2">Schedule</label>
              <div className="space-y-2.5">
                <label className="flex items-center gap-3 p-3 border border-[#E3E1DB] rounded-lg cursor-pointer hover:bg-[#F7F6F3] transition-colors">
                  <input type="radio" value="immediate" checked={formData.scheduleType === 'immediate'} onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value, scheduleTime: '' })} className="text-[#D63B1F]" />
                  <div><p className="text-sm font-medium text-[#131210]">Send Immediately</p><p className="text-xs text-[#9B9890]">Starts sending right after creation</p></div>
                </label>
                <label className="flex items-center gap-3 p-3 border border-[#E3E1DB] rounded-lg cursor-pointer hover:bg-[#F7F6F3] transition-colors">
                  <input type="radio" value="scheduled" checked={formData.scheduleType === 'scheduled'} onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value })} className="text-[#D63B1F]" />
                  <div><p className="text-sm font-medium text-[#131210]">Schedule for Later</p><p className="text-xs text-[#9B9890]">Pick a date and time</p></div>
                </label>
              </div>
              {formData.scheduleType === 'scheduled' && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Schedule Time *</label>
                  <input type="datetime-local" value={formData.scheduleTime} onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })} className="w-full px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]" />
                  {errors.scheduleTime && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.scheduleTime}</p>}
                </div>
              )}
            </section>
            )}

            {errors.submit && <div className="mt-5 bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] text-[#D63B1F] px-4 py-3 rounded-lg text-sm">{errors.submit}</div>}
          </div>
        </div>

        {/* Footer — Back / Next / Create */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-8 py-3.5 bg-[#FFFFFF] border-t border-[#E3E1DB] flex-shrink-0">
          <button type="button" onClick={step === 1 ? onClose : goBack} className="px-5 py-2.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] transition-colors">
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 4 ? (
            <button type="button" onClick={goNext} className="px-6 py-2.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg transition-colors">
              Next
            </button>
          ) : (
            <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50 transition-colors">
              {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-2"></i>Creating…</> : (formData.scheduleType === 'scheduled' ? 'Schedule Campaign' : 'Create & Send')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function ViewCampaignModal({ campaign, contactLists, phoneNumbers, isTrial, onClose, onCampaignUpdated, onLaunch, onPause, onArchive, onDelete }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editFormData, setEditFormData] = useState({ name: campaign.name, message: campaign.message_template || '' })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [executionLogs, setExecutionLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoadingLogs(true)
        const response = await apiGet(`/api/campaigns/${campaign.id}/executions`)
        const data = await response.json()
        if (data.success) setExecutionLogs(data.executions || [])
      } catch (error) {
        console.error('Error fetching execution logs:', error)
      } finally {
        setLoadingLogs(false)
      }
    }
    fetchLogs()
  }, [campaign.id])

  const validateEditForm = () => {
    const newErrors = {}
    if (!editFormData.name.trim()) newErrors.name = 'Campaign name is required'
    if (!editFormData.message.trim()) newErrors.message = 'Message is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleEditSubmit = async (e) => {
    e.preventDefault()
    if (!validateEditForm()) return
    setIsSubmitting(true)
    try {
      const response = await apiPost(`/api/campaigns/${campaign.id}/update`, editFormData)
      const data = await response.json()
      if (data.success) { setIsEditing(false); onCampaignUpdated() }
      else setErrors({ submit: data.error || 'Failed to update campaign' })
    } catch {
      setErrors({ submit: 'Failed to update campaign. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const getContactListName = (ids) => {
    if (!ids || !Array.isArray(ids) || ids.length === 0) return 'Unknown'
    const names = ids.map(id => contactLists.find(cl => cl.id === id)?.name).filter(Boolean)
    return names.length > 0 ? names.join(', ') : 'Unknown'
  }

  const formatDate = (dateString) => {
    try { return formatInTimeZone(new Date(dateString), 'UTC', 'MMM dd, yyyy HH:mm') }
    catch { return dateString }
  }

  const statusLabel = campaign.status === 'archived' ? 'Archived' : campaign.status === 'paused' ? 'Paused' : campaign.status === 'running' ? 'Running' : campaign.status === 'completed' ? 'Completed' : 'Active'
  const statusClass = campaign.status === 'archived' ? 'bg-[#EFEDE8] text-[#5C5A55]' : campaign.status === 'paused' ? 'bg-yellow-50 text-yellow-700' : campaign.status === 'running' ? 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' : campaign.status === 'completed' ? 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' : 'bg-green-50 text-green-700'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF]">
          <h3 className="text-sm font-semibold text-[#131210]">{isEditing ? 'Edit Campaign' : 'Campaign Details'}</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Campaign Name *</label>
              <input type="text" value={editFormData.name} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
              {errors.name && <p className="text-[#D63B1F] text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Message *</label>
              <textarea value={editFormData.message} onChange={(e) => setEditFormData({ ...editFormData, message: e.target.value })} rows="4" className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none" />
              {errors.message && <p className="text-[#D63B1F] text-xs mt-1">{errors.message}</p>}
            </div>
            {errors.submit && <div className="bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] text-[#D63B1F] px-3 py-2.5 rounded-md text-sm">{errors.submit}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setIsEditing(false); setErrors({}) }} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
                {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</> : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <div><p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Campaign Name</p><p className="text-sm text-[#131210] font-medium">{campaign.name}</p></div>
              <div><p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Message</p><p className="text-sm text-[#5C5A55] bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 whitespace-pre-wrap">{campaign.message_template}</p></div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  campaign.source === 'monday'
                    ? { label: 'Monday Board', value: campaign.monday_board_name || 'Monday board' }
                    : { label: 'Contact List', value: campaign.contact_list_names?.join(', ') || 'Unknown' },
                  { label: 'Sender Number', value: campaign.sender_number || 'Unknown' },
                  { label: 'Recipients', value: campaign.total_recipients ?? 0 },
                  { label: 'Created', value: formatDate(campaign.created_at) },
                ].map((item) => (
                  <div key={item.label}><p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">{item.label}</p><p className="text-sm text-[#5C5A55]">{item.value}</p></div>
                ))}
              </div>
              <div><p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Status</p><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>{statusLabel}</span></div>
            </div>

            <div className="border-t border-[#E3E1DB] px-5 py-4">
              <p className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider mb-3">Execution History</p>
              {loadingLogs ? (
                <p className="text-sm text-[#9B9890]">Loading…</p>
              ) : executionLogs.length === 0 ? (
                <p className="text-sm text-[#9B9890]">No execution logs yet</p>
              ) : (
                <div className="space-y-2">
                  {executionLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2">
                      <div>
                        <p className="text-sm text-[#5C5A55]">{formatDate(log.executed_at)}</p>
                        <p className="text-xs text-[#9B9890]">{log.sent_count} sent, {log.failed_count} failed</p>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${log.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]'}`}>{log.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[#E3E1DB] px-5 py-3.5 flex flex-wrap items-center gap-2">
              {campaign.status === 'draft' && (
                <button onClick={onLaunch} className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md transition-colors">
                  {isTrial ? <><i className="fas fa-lock text-xs"></i> Launch Campaign</> : <><i className="fas fa-rocket text-xs"></i> Launch Campaign</>}
                </button>
              )}
              <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Edit</button>
              <button onClick={onPause} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">{campaign.status === 'paused' ? 'Resume' : 'Pause'}</button>
              <button onClick={onArchive} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">{campaign.status === 'archived' ? 'Unarchive' : 'Archive'}</button>
              <button onClick={onDelete} className="px-3 py-1.5 text-sm text-[#D63B1F] border border-[rgba(214,59,31,0.14)] rounded-md hover:bg-[rgba(214,59,31,0.07)]">Delete</button>
              <button onClick={onClose} className="ml-auto px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CreateRVMCampaignModal({ contactLists, phoneNumbers, subscription, creditBalance = 0, onClose, onCreated }) {
  // Step 1 (Basics): name, sender, audio
  // Step 2 (Audience): contact lists + phone columns
  // Step 3 (Chunks & Preview): chunk size + chunk picker + recipient sample
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [senderNumber, setSenderNumber] = useState('')
  const [uploadState, setUploadState] = useState(null) // null | 'uploading' | { url, voicedropUrl, path, name }
  const [selectedListIds, setSelectedListIds] = useState([])
  const [selectedColumns, setSelectedColumns] = useState(['phone_number'])
  // Chunking removed from the UI — the throttle + calling windows now pace the
  // whole list automatically. chunkSize stays 0 (= send whole list) so all the
  // `chunkSize > 0` branches below are inert.
  const [chunkSize] = useState(0)
  const [chunkIndex] = useState(1)
  // Sending speed. Three modes:
  //   'recommended' → pick a team-size preset (maps to count/window below)
  //   'manual'      → throttleCount every (throttleWindowValue × throttleUnit)
  //   'max'         → no throttle (send as fast as allowed)
  // All three resolve to (resolvedThrottleCount, resolvedThrottleWindowSeconds)
  // — the same two fields the backend sweeper enforces.
  const [throttleMode, setThrottleMode] = useState('recommended')
  const [presetId, setPresetId] = useState('small')
  const [throttleCount, setThrottleCount] = useState(100)         // manual mode
  const [throttleWindowValue, setThrottleWindowValue] = useState(15)
  const [throttleUnit, setThrottleUnit] = useState('minute')
  const unitToSeconds = (u) => (u === 'day' ? 86400 : u === 'hour' ? 3600 : 60)
  const manualWindowSeconds = Math.max(60, throttleWindowValue * unitToSeconds(throttleUnit))

  const selectedPreset = THROTTLE_PRESETS.find(p => p.id === presetId) || THROTTLE_PRESETS[1]
  // Resolve the (count, windowSeconds) actually sent to the backend.
  const resolvedThrottleCount =
    throttleMode === 'recommended' ? selectedPreset.count
    : throttleMode === 'manual'    ? throttleCount
    : null   // 'max'
  const resolvedThrottleWindowSeconds =
    throttleMode === 'recommended' ? (selectedPreset.window || 3600)
    : throttleMode === 'manual'    ? manualWindowSeconds
    : 3600

  // ONE unified "When to send" control with four mutually-exclusive options:
  //   'now'      → start immediately, run 24/7 at the throttle rate
  //   'later'    → start at startAtLocal, then 24/7 at the throttle rate
  //   'best'     → only 10–12 & 2–4 each day (best callback windows)
  //   'business' → only 9–5 each day
  // Each maps to (starts_at, send_windows); the throttle paces the rate within.
  const [whenMode, setWhenMode] = useState('now')
  const [startAtLocal, setStartAtLocal] = useState('')   // "YYYY-MM-DDTHH:MM"
  const [sendTimezone, setSendTimezone] = useState('America/New_York')

  // Workspace business hours (from Settings) — powers the "Business hours"
  // option so it mirrors exactly what's configured there (hours, days, tz).
  const [businessHours, setBusinessHours] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiGet('/api/workspace/business-hours')
        const data = await res.json()
        if (!cancelled && data && (data.start || data.end)) setBusinessHours(data)
      } catch { /* fall back to the 9–5 default below */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Resolve calling windows / weekdays / timezone for the chosen mode.
  const resolvedSendWindows =
    whenMode === 'best'     ? SCHEDULE_PRESETS.best
    : whenMode === 'business' ? (businessHours
        ? [{ start: hhmm(businessHours.start), end: hhmm(businessHours.end) }]
        : SCHEDULE_PRESETS.business)
    : null   // 'now' / 'later' → anytime
  const resolvedSendDays =
    whenMode === 'best'   ? [1, 2, 3, 4, 5]   // Best calling windows = weekdays only (no Sat/Sun)
    : whenMode === 'business' && Array.isArray(businessHours?.days) && businessHours.days.length > 0 && businessHours.days.length < 7
      ? [...businessHours.days].sort((a, b) => a - b)
      : null
  // "Business hours" dictates its own timezone (from Settings); other modes use
  // the user-selected one.
  const resolvedTimezone = (whenMode === 'business' && businessHours?.tz) ? businessHours.tz : sendTimezone

  let resolvedStartsAt = null
  if (whenMode === 'later' && startAtLocal) {
    try { resolvedStartsAt = fromZonedTime(startAtLocal, resolvedTimezone).toISOString() } catch {}
  }

  // Optional per-day cap (works in every speed mode, including No throttle).
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(false)
  const [dailyLimit, setDailyLimit] = useState(500)
  const resolvedDailyCap = dailyLimitEnabled && dailyLimit > 0 ? Math.floor(dailyLimit) : null
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [created, setCreated] = useState(false)
  const fileInputRef = useRef(null)

  // Preview data (fetched lazily when Step 2 / Step 3 are visible)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [detectedColumns, setDetectedColumns] = useState([])  // [{key,label,count,isPrimary}]
  const [totalRecipients, setTotalRecipients] = useState(0)
  // Contact statuses to skip (call-outcome filter). Pre-checks the "don't
  // contact" set; the user can adjust on the Audience step.
  const [excludeStatuses, setExcludeStatuses] = useState(DEFAULT_EXCLUDED_STATUSES)
  const [excludedByStatus, setExcludedByStatus] = useState(0)
  const toggleExcludeStatus = (id) =>
    setExcludeStatuses(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  // Full recipient list for the currently selected chunk (capped at 50k server-side).
  // Step 3 paginates this client-side and lets the user search + per-row toggle.
  const [chunkRecipients, setChunkRecipients] = useState([])
  const [chunks, setChunks] = useState([])                    // [{n,start,end,count}]
  const [alreadySentChunks, setAlreadySentChunks] = useState([])
  const [previewTruncated, setPreviewTruncated] = useState(false)

  // Step 3 selection UI state. excludedPhones is a Set of phones the user has
  // unticked — default is "all included" and the user can unselect rows.
  // Resets whenever the chunk changes (per-chunk selection).
  const [excludedPhones, setExcludedPhones] = useState(() => new Set())
  // Landline scrub (Telnyx number lookup). scan: null | 'scanning' | {breakdown,byPhone,...}
  const [scan, setScan] = useState(null)
  const [scanError, setScanError] = useState('')
  const [landlinesRemoved, setLandlinesRemoved] = useState(false)
  const [purgeState, setPurgeState] = useState(null)   // null | 'purging' | 'done'
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 500

  // Reset selection + page whenever the chunk slice changes.
  useEffect(() => {
    setExcludedPhones(new Set())
    setSearchQuery('')
    setCurrentPage(1)
  }, [chunkIndex, chunkSize, selectedListIds.join(','), selectedColumns.join(',')])

  const verifiedNumbers = phoneNumbers.filter(pn => pn.voicedrop_verified)

  const toggleList = (id) => {
    setSelectedListIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleColumn = (k) => {
    setSelectedColumns(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }

  // ── Audio upload (cancelable) ──────────────────────────────────────────
  const uploadAbortRef = useRef(null)
  const uploadAudioFile = async (file, displayName) => {
    setUploadState('uploading')
    setErrors(prev => ({ ...prev, audio: null }))
    const form = new FormData()
    form.append('file', file, file.name)
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const user = getCurrentUser()
      const res = await fetch('/api/voicemail-campaigns/upload-audio', {
        method: 'POST',
        headers: { 'x-workspace-id': user?.workspaceId, 'x-user-id': user?.userId },
        body: form,
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setErrors(prev => ({ ...prev, audio: data.error || 'Upload failed' }))
        setUploadState(null)
        return
      }
      setUploadState({ url: data.url, voicedropUrl: data.voicedrop_url, path: data.path, name: displayName || file.name })
    } catch (err) {
      if (err?.name === 'AbortError') { setUploadState(null); return }   // cancelled
      setErrors(prev => ({ ...prev, audio: 'Upload failed. Please try again.' }))
      setUploadState(null)
    } finally {
      uploadAbortRef.current = null
    }
  }
  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) uploadAudioFile(file, file.name)
  }
  const cancelUpload = () => {
    uploadAbortRef.current?.abort()
    setUploadState(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Live audio recording (captures PCM → WAV so VoiceDrop accepts it) ───
  // recording: null | 'recording' | { blob, url, seconds }
  const [recording, setRecording] = useState(null)
  const audioCtxRef = useRef(null)
  const procRef = useRef(null)
  const sourceRef = useRef(null)
  const recStreamRef = useRef(null)
  const pcmChunksRef = useRef([])
  const recSampleRateRef = useRef(44100)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const canvasRef = useRef(null)

  // Live waveform — animated bars that react to mic volume so you can SEE it's
  // picking up your voice.
  const drawVisualizer = () => {
    rafRef.current = requestAnimationFrame(drawVisualizer)
    const analyser = analyserRef.current
    const canvas = canvasRef.current
    if (!analyser || !canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    const bins = analyser.frequencyBinCount
    const data = new Uint8Array(bins)
    analyser.getByteFrequencyData(data)
    ctx.clearRect(0, 0, w, h)
    const bars = 48
    const step = Math.max(1, Math.floor(bins / bars))
    const barW = w / bars
    for (let i = 0; i < bars; i++) {
      const v = (data[i * step] || 0) / 255
      const bh = Math.max(2, v * h)
      ctx.fillStyle = '#D63B1F'
      ctx.fillRect(i * barW + barW * 0.25, (h - bh) / 2, barW * 0.5, bh)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      recSampleRateRef.current = ctx.sampleRate
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      pcmChunksRef.current = []
      proc.onaudioprocess = (e) => { pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
      source.connect(proc)
      proc.connect(ctx.destination)
      // Tap the same signal for the live waveform.
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      analyserRef.current = analyser
      setErrors(prev => ({ ...prev, audio: null }))
      setRecording('recording')
      rafRef.current = requestAnimationFrame(drawVisualizer)
    } catch {
      setErrors(prev => ({ ...prev, audio: 'Could not access the microphone — check browser permissions.' }))
    }
  }
  const stopRecording = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    analyserRef.current = null
    try { if (procRef.current) procRef.current.onaudioprocess = null; sourceRef.current?.disconnect(); procRef.current?.disconnect() } catch {}
    recStreamRef.current?.getTracks().forEach(t => t.stop())
    const chunks = pcmChunksRef.current
    let len = 0; for (const c of chunks) len += c.length
    const pcm = new Float32Array(len); let off = 0
    for (const c of chunks) { pcm.set(c, off); off += c.length }
    const sr = recSampleRateRef.current
    const blob = new Blob([encodeWAV(pcm, sr)], { type: 'audio/wav' })
    setRecording({ blob, url: URL.createObjectURL(blob), seconds: Math.max(1, Math.round(len / sr)) })
    try { audioCtxRef.current?.close() } catch {}
  }
  const discardRecording = () => {
    if (recording && recording.url) URL.revokeObjectURL(recording.url)
    setRecording(null)
  }
  const useRecording = async () => {
    if (!recording || !recording.blob) return
    const file = new File([recording.blob], `recording-${recording.seconds}s.wav`, { type: 'audio/wav' })
    discardRecording()
    await uploadAudioFile(file, 'Live recording')
  }
  // Safety: if the modal closes mid-recording, release the mic + stop the loop.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    recStreamRef.current?.getTracks().forEach(t => t.stop())
    try { audioCtxRef.current?.close() } catch {}
  }, [])

  // ── Preview fetch (debounced) ──────────────────────────────────────────
  // Step 2: discovers columns (call WITHOUT chunkSize/columns)
  // Step 3: refreshes chunks for the selected columns + chunk size
  useEffect(() => {
    if (step === 1) return
    if (selectedListIds.length === 0) {
      setDetectedColumns([]); setTotalRecipients(0); setChunkRecipients([])
      setChunks([]); setAlreadySentChunks([]); setPreviewTruncated(false)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    // Step 2: just detect columns (no chunk slicing).
    // Step 3: ask for the FULL chunk recipient list (capped at 50k server-side).
    const body = {
      contactListIds: selectedListIds,
      phoneColumns: step >= 3 ? selectedColumns : undefined,
      chunkSize: step >= 3 ? chunkSize : 0,
      chunkIndex: step >= 3 && chunkSize > 0 ? chunkIndex : 0,
      excludeStatuses,
    }
    apiPost('/api/voicemail-campaigns/preview', body)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data?.success) {
          setDetectedColumns(data.detectedColumns || [])
          setTotalRecipients(data.totalRecipients || 0)
          setExcludedByStatus(data.excludedByStatus || 0)
          setChunkRecipients(data.recipients || [])
          setPreviewTruncated(!!data.truncated)
          setChunks(data.chunks || [])
          setAlreadySentChunks(data.alreadySentChunks || [])
        }
      })
      .catch(() => { /* silent — UI just stays empty */ })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [step, selectedListIds.join(','), selectedColumns.join(','), chunkSize, chunkIndex, excludeStatuses.join(',')])

  // ── Validation per step ────────────────────────────────────────────────
  const validateStep = (s) => {
    const errs = {}
    if (s === 1) {
      if (!name.trim()) errs.name = 'Campaign name is required'
      if (!senderNumber) errs.senderNumber = 'Sender number is required'
      if (!uploadState || uploadState === 'uploading') errs.audio = 'Please upload a voicemail recording'
    }
    if (s === 2) {
      if (selectedListIds.length === 0) errs.contactLists = 'Select at least one contact list'
      if (selectedColumns.length === 0) errs.columns = 'Select at least one phone column'
    }
    if (s === 3) {
      if (chunkSize > 0 && (chunkIndex < 1 || chunkIndex > Math.max(1, chunks.length))) errs.chunk = 'Pick a chunk'
      if (totalRecipients === 0) errs.recipients = 'No recipients in selection'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }
  const goNext = () => { if (validateStep(step)) setStep(s => Math.min(4, s + 1)) }
  const goBack = () => { setErrors({}); setStep(s => Math.max(1, s - 1)) }

  // ── Launch ─────────────────────────────────────────────────────────────
  // The exact recipients the user has chosen for THIS launch (after chunk
  // pick + manual unticks + search). The backend will enqueue exactly this set.
  const selectedRecipients = chunkRecipients.filter(r => !excludedPhones.has(r.phone))

  // ── Landline scrub ────────────────────────────────────────────────────────
  const scanLandlines = async () => {
    const phones = [...new Set(selectedRecipients.map(r => r.phone))]
    if (phones.length === 0) return
    setScanError(''); setScan('scanning'); setLandlinesRemoved(false); setPurgeState(null)
    try {
      const res = await apiPost('/api/voicemail-campaigns/landline-scan', { phones })
      const data = await res.json()
      if (!data.success) {
        setScanError(data.error === 'Insufficient credits'
          ? `Not enough credits — this scan needs ${data.required} (you have ${data.available}).`
          : (data.error || 'Scan failed'))
        setScan(null); return
      }
      setScan(data)
    } catch { setScanError('Scan failed — please try again.'); setScan(null) }
  }
  const landlinePhones = (scan && scan.byPhone) ? Object.keys(scan.byPhone).filter(p => scan.byPhone[p] === 'landline') : []
  const removeLandlinesFromCampaign = () => {
    setExcludedPhones(prev => { const n = new Set(prev); landlinePhones.forEach(p => n.add(p)); return n })
    setLandlinesRemoved(true)
  }
  const purgeLandlinesFromContacts = async () => {
    setPurgeState('purging')
    try {
      const res = await apiPost('/api/contacts/bulk-delete-by-phone', { phones: landlinePhones })
      const data = await res.json()
      setPurgeState(data.success ? 'done' : null)
      if (!data.success) setScanError(data.error || 'Failed to remove from contacts')
    } catch { setPurgeState(null); setScanError('Failed to remove from contacts') }
  }

  const handleLaunch = async () => {
    if (!validateStep(3)) return
    if (selectedRecipients.length === 0) {
      setErrors({ recipients: 'At least one recipient must be selected' })
      return
    }
    setIsSubmitting(true)
    setErrors({})
    try {
      const payload = {
        name: name.trim(),
        recordingUrl: uploadState.voicedropUrl || uploadState.url,
        recordingPath: uploadState.path,
        voicedropRecordingUrl: uploadState.voicedropUrl || null,
        senderNumber,
        contactListIds: selectedListIds,
        phoneColumns: selectedColumns,
        chunkSize: chunkSize > 0 ? chunkSize : 0,
        chunkIndex: chunkSize > 0 ? chunkIndex : 0,
        throttleCount: resolvedThrottleCount,
        throttleWindowSeconds: resolvedThrottleWindowSeconds,
        sendWindows: resolvedSendWindows,
        sendTimezone: resolvedTimezone,
        sendDays: resolvedSendDays,
        dailyCap: resolvedDailyCap,
        excludeStatuses,
        startsAt: resolvedStartsAt,
        explicitRecipients: selectedRecipients.map(r => ({
          phone: r.phone,
          contactId: r.contactId,
          sourceColumn: r.sourceColumn,
        })),
      }
      const response = await apiPost('/api/voicemail-campaigns', payload)
      const data = await response.json()
      if (!data.success) { setErrors({ submit: data.error || 'Failed to create campaign' }); return }
      // Auto-launch (matches legacy behavior).
      const startRes = await apiPost(`/api/voicemail-campaigns/${data.campaign.id}/start`, {})
      const startData = await startRes.json()
      if (!startRes.ok || !startData.success) {
        setErrors({ submit: startData.message || startData.error || 'Created as draft — could not start. Open it and press Launch to retry.' })
        return
      }
      setCreated(true)
    } catch {
      setErrors({ submit: 'Failed to create campaign. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
          <div className="px-5 py-8 text-center">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fas fa-check text-green-600"></i></div>
            <h3 className="text-sm font-semibold text-[#131210] mb-1">Voicemail campaign launched</h3>
            <p className="text-xs text-[#9B9890] mb-4">
              {`Dispatching to ${selectedRecipients.length.toLocaleString()} ${selectedRecipients.length === 1 ? 'recipient' : 'recipients'} via the queue. You can close this tab — open the campaign to watch progress.`}
            </p>
            <button onClick={onCreated} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">View Campaigns</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Wizard chrome ──────────────────────────────────────────────────────
  const stepLabel = (n) => (
    { 1: 'Basics', 2: 'Audience', 3: 'Recipients', 4: 'Review' }[n] || ''
  )

  return (
    <div className="fixed inset-0 z-50 bg-[#F7F6F3] flex flex-col">
      {/* Header — same pattern as the SMS New Campaign page */}
      <header className="bg-[#FFFFFF] border-b border-[#E3E1DB] flex-shrink-0">
        <div className="flex items-center gap-3 px-4 sm:px-8 pt-3.5 pb-2">
          <button type="button" onClick={onClose} className="p-2 -ml-2 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded-lg transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
          <h3 className="text-base sm:text-lg font-semibold text-[#131210]">New voicemail campaign</h3>
        </div>
        {/* Stepper */}
        <div className="flex items-center gap-1 sm:gap-2 px-4 sm:px-8 pb-3 overflow-x-auto">
          {[1, 2, 3, 4].map(n => {
            const active = step === n
            const done = step > n
            return (
              <div key={n} className="flex items-center gap-1 sm:gap-2 shrink-0">
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-md ${active ? 'bg-[#fdecea]' : ''}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${active ? 'bg-[#D63B1F] text-white' : done ? 'bg-[#1F8C4A] text-white' : 'bg-[#EFEDE8] text-[#9B9890]'}`}>{n}</span>
                  <span className={`text-xs font-medium ${active ? 'text-[#D63B1F]' : done ? 'text-[#5C5A55]' : 'text-[#9B9890]'}`}>{stepLabel(n)}</span>
                </div>
                {n < 4 && <span className="w-4 sm:w-8 h-px bg-[#E3E1DB]" />}
              </div>
            )
          })}
        </div>
      </header>

      {/* Scrollable body — Step 3 needs a wider container for the recipient table */}
      <div className="flex-1 overflow-y-auto">
        <div className={`mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-5 ${step === 3 ? 'max-w-7xl' : 'max-w-3xl'}`}>
          {/* ─── Step 1: Basics ─── */}
          {step === 1 && (
            <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-1">Basics</h4>
              <p className="text-xs text-[#9B9890] mb-4">Name your campaign, pick a voicemail-verified number, and upload the audio.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Campaign name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Reactivate cold leads — June outreach"
                  className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Sender number (voicemail-verified)</label>
                {verifiedNumbers.length === 0 ? (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 flex items-start gap-2">
                    <i className="fas fa-exclamation-triangle mt-0.5 flex-shrink-0" />
                    <span>No verified numbers found. Go to <strong>Settings → Phone Numbers</strong> and verify a number for voicemail before sending.</span>
                  </div>
                ) : (
                  <select
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  >
                    <option value="">Pick a verified number…</option>
                    {verifiedNumbers.map(pn => (
                      <option key={pn.id} value={pn.phoneNumber}>
                        {pn.custom_name ? `${pn.custom_name} (${pn.phoneNumber})` : pn.phoneNumber}
                      </option>
                    ))}
                  </select>
                )}
                {errors.senderNumber && <p className="text-xs text-red-600 mt-1">{errors.senderNumber}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Voicemail audio</label>
                <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />

                {/* Idle: upload OR record */}
                {!uploadState && !recording && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-6 border-2 border-dashed border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55] hover:border-[#D63B1F] hover:bg-[#FFF8F6]"
                    >
                      <i className="fas fa-cloud-upload-alt mr-2" /> Upload audio
                    </button>
                    <button
                      type="button"
                      onClick={startRecording}
                      className="px-4 py-6 border-2 border-dashed border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55] hover:border-[#D63B1F] hover:bg-[#FFF8F6]"
                    >
                      <i className="fas fa-microphone mr-2 text-[#D63B1F]" /> Record now
                    </button>
                  </div>
                )}

                {/* Recording in progress — live waveform reacts to your voice */}
                {recording === 'recording' && (
                  <div className="flex items-center gap-3 px-4 py-3 border border-[#D63B1F] rounded-lg bg-[#FFF8F6]">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D63B1F] animate-pulse flex-shrink-0" />
                    <span className="text-sm text-[#131210] flex-shrink-0">Recording…</span>
                    <canvas ref={canvasRef} width={480} height={36} className="flex-1 min-w-0 h-9" />
                    <button type="button" onClick={stopRecording} className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] rounded-md hover:bg-[#c4351b]">
                      <i className="fas fa-stop mr-1.5 text-[11px]" /> Stop
                    </button>
                  </div>
                )}

                {/* Recorded — preview, then use or re-record */}
                {recording && recording !== 'recording' && (
                  <div className="px-4 py-3 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3] space-y-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-[#5C5A55] flex-1">Your recording ({recording.seconds}s) — listen back:</p>
                    </div>
                    <audio controls src={recording.url} className="w-full" style={{ height: 34 }} />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={useRecording} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] rounded-md hover:bg-[#c4351b]">
                        <i className="fas fa-check mr-1.5 text-[11px]" /> Use this recording
                      </button>
                      <button type="button" onClick={() => { discardRecording(); startRecording() }} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-white">
                        <i className="fas fa-rotate-left mr-1.5 text-[11px]" /> Re-record
                      </button>
                      <button type="button" onClick={discardRecording} className="px-3 py-1.5 text-sm text-[#9B9890] hover:text-[#5C5A55]">Discard</button>
                    </div>
                  </div>
                )}

                {/* Uploading — with cancel */}
                {uploadState === 'uploading' && (
                  <div className="flex items-center gap-3 px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55]">
                    <i className="fas fa-spinner fa-spin" />
                    <span className="flex-1">Uploading…</span>
                    <button type="button" onClick={cancelUpload} className="px-2.5 py-1 text-xs font-medium text-[#D63B1F] border border-[#D63B1F] rounded hover:bg-[#FFF8F6]">
                      <i className="fas fa-times mr-1" /> Cancel
                    </button>
                  </div>
                )}
                {uploadState && uploadState !== 'uploading' && (
                  <div className="flex items-center gap-3 px-4 py-3 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3]">
                    <i className="fas fa-music text-[#D63B1F]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#131210] truncate">{uploadState.name}</p>
                      <p className="text-xs text-[#9B9890]">{uploadState.voicedropUrl ? 'Audio uploaded' : 'Stored locally'}</p>
                    </div>
                    <button type="button" onClick={() => { setUploadState(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-xs text-[#9B9890] hover:text-[#5C5A55]">Replace</button>
                  </div>
                )}
                {errors.audio && <p className="text-xs text-red-600 mt-1">{errors.audio}</p>}
              </div>

              {/* Sending speed */}
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-2">Sending speed</label>

                {/* Mode selector: Recommended → Manual → No throttle */}
                <div className="inline-flex rounded-lg border border-[#D4D1C9] overflow-hidden mb-3">
                  {[
                    { id: 'recommended', label: 'Recommended' },
                    { id: 'manual',      label: 'Manual' },
                    { id: 'max',         label: 'No throttle' },
                  ].map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setThrottleMode(m.id)}
                      className={`px-3.5 py-1.5 text-sm transition-colors ${i > 0 ? 'border-l border-[#D4D1C9]' : ''} ${
                        throttleMode === m.id ? 'bg-[#D63B1F] text-white font-medium' : 'bg-white text-[#5C5A55] hover:bg-[#F7F6F3]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Recommended → team-size preset table */}
                {throttleMode === 'recommended' && (
                  <div className="border border-[#E3E1DB] rounded-lg overflow-hidden">
                    {THROTTLE_PRESETS.map((p, i) => {
                      const active = presetId === p.id
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${i > 0 ? 'border-t border-[#F0EEE9]' : ''} ${active ? 'bg-[#FFF8F6]' : 'hover:bg-[#F7F6F3]'}`}
                        >
                          <input
                            type="radio"
                            name="rvm-preset"
                            checked={active}
                            onChange={() => setPresetId(p.id)}
                            className="w-4 h-4 accent-[#D63B1F] flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#131210]">{p.team}</p>
                            <p className="text-[11px] text-[#9B9890]">{p.callbacks}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-sm font-medium text-[#131210]">{p.volume}</span>
                            <span className="block text-[10px] text-[#9B9890]">voicemails / hour</span>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}

                {/* Manual → custom rate */}
                {throttleMode === 'manual' && (
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-[#5C5A55]">Send up to</span>
                      <input
                        type="number"
                        min={1}
                        value={throttleCount}
                        onChange={(e) => setThrottleCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-20 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                      <span className="text-sm text-[#5C5A55]">every</span>
                      <input
                        type="number"
                        min={1}
                        value={throttleWindowValue}
                        onChange={(e) => setThrottleWindowValue(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                      <select
                        value={throttleUnit}
                        onChange={(e) => setThrottleUnit(e.target.value)}
                        className="px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      >
                        <option value="minute">{throttleWindowValue === 1 ? 'minute' : 'minutes'}</option>
                        <option value="hour">{throttleWindowValue === 1 ? 'hour' : 'hours'}</option>
                        <option value="day">{throttleWindowValue === 1 ? 'day' : 'days'}</option>
                      </select>
                    </div>
                  </div>
                )}

                {throttleMode === 'max' && (
                  <p className="text-[11px] text-[#9B9890] mt-2">Best for small lists or when you can handle callbacks immediately.</p>
                )}

                {/* Optional per-day limit — works in every speed mode */}
                <div className="mt-3 pt-3 border-t border-[#F0EEE9]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dailyLimitEnabled}
                      onChange={(e) => setDailyLimitEnabled(e.target.checked)}
                      className="w-4 h-4 accent-[#D63B1F]"
                    />
                    <span className="text-sm text-[#131210]">Set a daily limit</span>
                  </label>
                  {dailyLimitEnabled && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap pl-6">
                      <span className="text-sm text-[#5C5A55]">No more than</span>
                      <input
                        type="number"
                        min={1}
                        value={dailyLimit}
                        onChange={(e) => setDailyLimit(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-24 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                      <span className="text-sm text-[#5C5A55]">voicemails per day</span>
                    </div>
                  )}
                  <p className="text-[11px] text-[#9B9890] mt-1.5 pl-6">
                    {dailyLimitEnabled
                      ? 'Once the day’s limit is reached, the rest automatically continue the next day.'
                      : 'Optional — cap how many go out each day for a big list. The rest roll to the next day.'}
                  </p>
                </div>
              </div>

              {/* When to send — one unified control (start + calling hours) */}
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-2">When to send</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { id: 'now',      label: 'Send now',            hint: 'Starts now, around the clock' },
                    { id: 'later',    label: 'Schedule for later',  hint: 'Starts at a date & time you pick' },
                    { id: 'best',     label: 'Best calling windows', hint: 'Mon–Fri, 10–12 & 2–4 only' },
                    { id: 'business', label: 'Business hours',       hint: businessHours ? `${hhmm(businessHours.start)}–${hhmm(businessHours.end)}, ${formatDays(businessHours.days)}` : 'From your settings' },
                  ].map(m => {
                    const active = whenMode === m.id
                    return (
                      <label
                        key={m.id}
                        className={`flex items-start gap-2 px-3 py-2.5 border rounded-lg cursor-pointer ${active ? 'border-[#D63B1F] bg-[#FFF8F6]' : 'border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}
                      >
                        <input
                          type="radio"
                          name="rvm-when"
                          checked={active}
                          onChange={() => setWhenMode(m.id)}
                          className="w-4 h-4 mt-0.5 accent-[#D63B1F] flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#131210]">{m.label}</p>
                          <p className="text-[11px] text-[#9B9890]">{m.hint}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>

                {whenMode === 'later' && (
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    <input
                      type="datetime-local"
                      value={startAtLocal}
                      onChange={(e) => setStartAtLocal(e.target.value)}
                      className="px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                    />
                    <span className="text-[11px] text-[#9B9890]">
                      {TIMEZONES.find(t => t.id === sendTimezone)?.label || sendTimezone}
                      {resolvedStartsAt && new Date(resolvedStartsAt) <= new Date() && ' — that time is in the past; it will send now'}
                    </span>
                  </div>
                )}

                {/* Timezone — user-selectable for later/best; fixed (from
                    Settings) for business hours. */}
                {(whenMode === 'later' || whenMode === 'best') && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="text-[11px] text-[#9B9890]">Timezone</span>
                    <select
                      value={sendTimezone}
                      onChange={(e) => setSendTimezone(e.target.value)}
                      className="px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                    >
                      {TIMEZONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                )}

                <p className="text-[11px] text-[#9B9890] mt-2">
                  {whenMode === 'business'
                    ? <>Mirrors your workspace <strong>business hours</strong>: <strong>{resolvedSendWindows.map(w => `${w.start}–${w.end}`).join(' & ')}</strong>, <strong>{formatDays(resolvedSendDays || businessHours?.days)}</strong> ({TIMEZONES.find(t => t.id === resolvedTimezone)?.label || resolvedTimezone}). Change them in Settings → Business hours.</>
                    : whenMode === 'best'
                    ? <>Only sends <strong>Mon–Fri</strong> during <strong>{SCHEDULE_PRESETS.best.map(w => `${w.start}–${w.end}`).join(' & ')}</strong> (no weekends). Your sending speed paces voicemails within those hours.</>
                    : whenMode === 'later'
                    ? 'Sends at or after this time — no need to hit an exact minute.'
                    : 'Begins sending as soon as the campaign is created, at your sending speed.'}
                </p>
              </div>
            </div>
            </section>
          )}

          {/* ─── Step 2: Audience ─── */}
          {step === 2 && (
            <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-1">Audience</h4>
              <p className="text-xs text-[#9B9890] mb-4">Pick the contact lists and which phone columns each contact should be sent to.</p>
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-2">Contact lists</label>
                {contactLists.length === 0 ? (
                  <p className="text-xs text-[#9B9890]">No contact lists yet — import one in Contacts first.</p>
                ) : (
                  <div className="border border-[#E3E1DB] rounded-lg max-h-44 overflow-y-auto">
                    {contactLists.map(l => (
                      <label key={l.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3] border-b border-[#F0EEE9] last:border-b-0">
                        <input
                          type="checkbox"
                          checked={selectedListIds.includes(l.id)}
                          onChange={() => toggleList(l.id)}
                          className="w-4 h-4 accent-[#D63B1F]"
                        />
                        <span className="text-sm text-[#131210] flex-1">{l.name}</span>
                        <span className="text-xs text-[#9B9890]">{l.contact_count || l.contactsCount || ''}</span>
                      </label>
                    ))}
                  </div>
                )}
                {errors.contactLists && <p className="text-xs text-red-600 mt-1">{errors.contactLists}</p>}
              </div>

              {selectedListIds.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-2">
                    Phone columns to send to
                    {previewLoading && <i className="fas fa-spinner fa-spin ml-2 text-[#9B9890]" />}
                  </label>
                  <p className="text-[11px] text-[#9B9890] mb-2">
                    Pick every column you want to send to. Each contact gets one voicemail per non-empty column selected.
                  </p>
                  {detectedColumns.length === 0 && !previewLoading && (
                    <p className="text-xs text-[#9B9890]">No phone-like values found in these lists.</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {detectedColumns.map(col => (
                      <label key={col.key} className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${selectedColumns.includes(col.key) ? 'border-[#D63B1F] bg-[#FFF8F6]' : 'border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(col.key)}
                          onChange={() => toggleColumn(col.key)}
                          className="w-4 h-4 accent-[#D63B1F]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#131210] truncate">{col.label}</p>
                          <p className="text-[11px] text-[#9B9890]">{col.count} contacts{col.isPrimary ? ' · primary' : ''}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {errors.columns && <p className="text-xs text-red-600 mt-1">{errors.columns}</p>}
                </div>
              )}

              {/* Don't-send filter by call outcome (contact status) */}
              {selectedListIds.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-2">Don’t send to contacts marked</label>
                  <p className="text-[11px] text-[#9B9890] mb-2">
                    Skip contacts with these call outcomes. Set a contact’s status from the inbox after a call.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CONTACT_STATUSES.map(s => {
                      const on = excludeStatuses.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleExcludeStatus(s.id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${on ? 'border-transparent' : 'border-[#E3E1DB] bg-white text-[#9B9890] hover:bg-[#F7F6F3]'}`}
                          style={on ? { color: s.color, background: s.bg } : undefined}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ background: on ? s.color : '#C9C6BF' }} />
                          {s.label}
                          {on && <i className="fas fa-check text-[10px]" />}
                        </button>
                      )
                    })}
                  </div>
                  {excludedByStatus > 0 && (
                    <p className="text-[11px] text-[#D63B1F] mt-2">
                      <i className="fas fa-filter mr-1" />{excludedByStatus.toLocaleString()} contact{excludedByStatus === 1 ? '' : 's'} excluded by status.
                    </p>
                  )}
                </div>
              )}
            </div>
            </section>
          )}

          {/* ─── Step 3: Chunks & Preview (full audience editor) ─── */}
          {step === 3 && (() => {
            // Filter + paginate the visible chunk recipients.
            const q = searchQuery.trim().toLowerCase()
            const filtered = q
              ? chunkRecipients.filter(r =>
                  (r.name || '').toLowerCase().includes(q) ||
                  (r.phone || '').toLowerCase().includes(q))
              : chunkRecipients
            const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
            const page = Math.min(currentPage, totalPages)
            const pageStart = (page - 1) * PAGE_SIZE
            const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE)
            const selectedCount = chunkRecipients.length - excludedPhones.size
            const filteredSelected = filtered.filter(r => !excludedPhones.has(r.phone)).length
            const pageAllSelected = pageRows.length > 0 && pageRows.every(r => !excludedPhones.has(r.phone))

            const togglePhone = (phone) => {
              setExcludedPhones(prev => {
                const next = new Set(prev)
                if (next.has(phone)) next.delete(phone); else next.add(phone)
                return next
              })
            }
            const setExcludedFor = (rows, exclude) => {
              setExcludedPhones(prev => {
                const next = new Set(prev)
                for (const r of rows) {
                  if (exclude) next.add(r.phone); else next.delete(r.phone)
                }
                return next
              })
            }

            // Projected delivery — simulate the real schedule (sending speed +
            // calling hours + daily limit) so we can say, in plain language, how
            // long the whole list takes and when it finishes.
            const projAudience = selectedRecipients.length
            const projRatePerHour = resolvedThrottleCount
              ? resolvedThrottleCount / (resolvedThrottleWindowSeconds / 3600)
              : null   // no throttle → carrier speed
            const projStartMs = resolvedStartsAt ? Math.max(Date.now(), new Date(resolvedStartsAt).getTime()) : Date.now()
            const projSchedule = projAudience > 0
              ? estimateSendSchedule(projAudience, projStartMs, resolvedThrottleCount, resolvedThrottleWindowSeconds, resolvedSendWindows, resolvedTimezone, resolvedDailyCap || 0, resolvedSendDays)
              : []
            const projFirstMs = projSchedule.length ? new Date(projSchedule[0]).getTime() : projStartMs
            const projLastMs = projSchedule.length ? new Date(projSchedule[projSchedule.length - 1]).getTime() : projStartMs
            const projSpanMs = projLastMs - projFirstMs
            const tzAbbr = (TIMEZONES.find(t => t.id === resolvedTimezone)?.label.match(/\(([^)]+)\)/)?.[1]) || ''
            const fmtTz = (ms, pat) => { try { return formatInTimeZone(new Date(ms), resolvedTimezone, pat) } catch { return '' } }
            const projMultiDay = fmtTz(projFirstMs, 'yyyy-MM-dd') !== fmtTz(projLastMs, 'yyyy-MM-dd')
            // Effective per-day volume — only shown when it actually spans days.
            const projHoursPerDay = (resolvedSendWindows && resolvedSendWindows.length > 0)
              ? resolvedSendWindows.reduce((s, w) => {
                  const [sh, sm] = w.start.split(':').map(Number)
                  const [eh, em] = w.end.split(':').map(Number)
                  return s + Math.max(0, (eh * 60 + em) - (sh * 60 + sm)) / 60
                }, 0)
              : 24
            const projPerDay = projRatePerHour
              ? Math.min(resolvedDailyCap || Infinity, Math.max(1, Math.round(projRatePerHour * projHoursPerDay)))
              : (resolvedDailyCap || null)
            const projDays = projPerDay ? Math.ceil(projAudience / projPerDay) : null
            const projScheduledFuture = !!(resolvedStartsAt && new Date(resolvedStartsAt).getTime() > Date.now())
            const projInstant = !projRatePerHour && projSpanMs < 60000   // no throttle, fits one burst

            return (
              <div className="space-y-4">
                {/* Audio preview bar */}
                {uploadState && uploadState !== 'uploading' && (
                  <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg p-3 flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <p className="text-[10px] uppercase tracking-wider text-[#9B9890] font-medium">Voicemail audio</p>
                      <p className="text-xs text-[#131210] truncate max-w-[200px]">{uploadState.name}</p>
                    </div>
                    <audio controls src={uploadState.url} className="flex-1" style={{ height: 34 }} />
                  </div>
                )}

                {/* Projected delivery — plain-language "how long / when done" */}
                {projAudience > 0 && (
                  <div className="bg-[#FFF8F6] border border-[rgba(214,59,31,0.2)] rounded-lg p-3.5">
                    <p className="text-[10px] uppercase tracking-wider text-[#D63B1F] font-semibold mb-1.5">Projected delivery</p>
                    <p className="text-sm text-[#131210] leading-relaxed">
                      <strong>{projAudience.toLocaleString()}</strong> voicemail{projAudience === 1 ? '' : 's'}
                      {projScheduledFuture && <> — starts <strong>{fmtTz(projFirstMs, "MMM d 'at' h:mm a")} {tzAbbr}</strong></>}
                      {projMultiDay ? (
                        <>
                          {' '}— about <strong>{projPerDay.toLocaleString()}/day</strong>
                          {projRatePerHour && <> (at {Math.round(projRatePerHour).toLocaleString()}/hour)</>}.
                          {' '}Finishes around <strong>{fmtTz(projLastMs, 'MMM d')}</strong>
                          {projDays ? <> — about <strong>{projDays} day{projDays === 1 ? '' : 's'}</strong></> : null}.
                        </>
                      ) : projInstant ? (
                        <>{' '}— sent within a couple of minutes (as fast as the carrier accepts).</>
                      ) : (
                        <>
                          {' '}— finishes in <strong>{humanizeSpan(projSpanMs)}</strong>
                          {projRatePerHour && <> at <strong>{Math.round(projRatePerHour).toLocaleString()}/hour</strong></>},
                          {' '}done around <strong>{fmtTz(projLastMs, 'h:mm a')} {tzAbbr}</strong>.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {/* ─── Landline scrub (Telnyx carrier lookup) ─── */}
                {selectedRecipients.length > 0 && (() => {
                  const uniqueCount = new Set(selectedRecipients.map(r => r.phone)).size
                  const chip = (n, label, color, bg) => (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ color, background: bg }}>
                      <strong>{n.toLocaleString()}</strong> {label}
                    </span>
                  )
                  return (
                    <div className="bg-white border border-[#E3E1DB] rounded-lg p-3.5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-[#5C5A55] font-semibold">Landline scrub</p>
                          <p className="text-[11px] text-[#9B9890] mt-0.5">Ringless voicemail can’t land on landlines. Check carrier types and drop them.</p>
                        </div>
                        {!scan && (
                          <button type="button" onClick={scanLandlines}
                            className="flex-shrink-0 px-3 py-1.5 text-sm rounded-md bg-[#131210] text-white hover:bg-black flex items-center gap-2">
                            <i className="fas fa-magnifying-glass text-[11px]" /> Scan {uniqueCount.toLocaleString()} numbers
                          </button>
                        )}
                        {scan === 'scanning' && (
                          <span className="flex-shrink-0 text-sm text-[#5C5A55] flex items-center gap-2"><i className="fas fa-spinner fa-spin" /> Checking carriers…</span>
                        )}
                      </div>

                      {!scan && (
                        <p className="text-[11px] text-[#9B9890] mt-2">Up to <strong>{(uniqueCount * 0.5).toLocaleString()} credits</strong> (0.5 each). Numbers checked before are free.</p>
                      )}
                      {scanError && <p className="text-xs text-red-600 mt-2">{scanError}</p>}

                      {scan && scan !== 'scanning' && (
                        <div className="mt-3">
                          <div className="flex flex-wrap gap-2">
                            {chip(scan.breakdown.mobile, 'mobile', '#16A34A', '#EAF7EE')}
                            {chip(scan.breakdown.voip, 'voip', '#2563EB', '#EAF0FE')}
                            {chip(scan.breakdown.landline, 'landline', '#D63B1F', '#FDEAEA')}
                            {scan.breakdown.unknown > 0 && chip(scan.breakdown.unknown, 'unknown', '#6B7280', '#F1F1EF')}
                          </div>
                          <p className="text-[11px] text-[#9B9890] mt-2">
                            Checked {scan.breakdown.total.toLocaleString()} · {scan.newLookups.toLocaleString()} new ({scan.creditsCharged} credits), {scan.cached.toLocaleString()} already known.
                            {' '}<button type="button" onClick={scanLandlines} className="text-[#D63B1F] hover:underline">Scan again</button>
                          </p>

                          {landlinePhones.length === 0 ? (
                            <p className="text-sm text-green-700 mt-2"><i className="fas fa-check-circle mr-1" /> No landlines found — your list is clean.</p>
                          ) : !landlinesRemoved ? (
                            <button type="button" onClick={removeLandlinesFromCampaign}
                              className="mt-2.5 px-3 py-1.5 text-sm rounded-md bg-[#D63B1F] text-white hover:bg-[#c4351b]">
                              Remove {landlinePhones.length.toLocaleString()} landline{landlinePhones.length === 1 ? '' : 's'} from this campaign
                            </button>
                          ) : (
                            <div className="mt-2.5">
                              <p className="text-sm text-[#131210]"><i className="fas fa-check-circle text-green-600 mr-1" /> Removed {landlinePhones.length.toLocaleString()} landline{landlinePhones.length === 1 ? '' : 's'} from this send.</p>
                              {purgeState === 'done' ? (
                                <p className="text-[11px] text-[#9B9890] mt-1"><i className="fas fa-trash-alt mr-1" />Also deleted from your contacts &amp; lists.</p>
                              ) : purgeState === 'kept' ? (
                                <p className="text-[11px] text-[#9B9890] mt-1">Kept in your contacts.</p>
                              ) : (
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] text-[#5C5A55]">Also delete these {landlinePhones.length.toLocaleString()} landlines from your contacts &amp; lists?</span>
                                  <button type="button" onClick={purgeLandlinesFromContacts} disabled={purgeState === 'purging'}
                                    className="px-2.5 py-1 text-xs rounded border border-[#D63B1F] text-[#D63B1F] hover:bg-[#FFF8F6] disabled:opacity-60">
                                    {purgeState === 'purging' ? 'Removing…' : 'Delete from contacts'}
                                  </button>
                                  <button type="button" onClick={() => setPurgeState('kept')}
                                    className="px-2.5 py-1 text-xs rounded border border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3]">Keep</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* ─── Searchable, paginated, selectable recipient table ─── */}
                <div className="min-w-0">
                  {/* Toolbar: search + bulk actions + selected count */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="relative flex-1 min-w-[220px]">
                      <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
                        placeholder="Search by name or phone…"
                        className="w-full pl-8 pr-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setExcludedFor(pageRows, !pageAllSelected)}
                      className="px-3 py-2 text-xs text-[#5C5A55] border border-[#D4D1C9] rounded-md hover:bg-[#F7F6F3]"
                    >
                      {pageAllSelected ? 'Unselect page' : 'Select page'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExcludedFor(filtered, false)}
                      className="px-3 py-2 text-xs text-[#5C5A55] border border-[#D4D1C9] rounded-md hover:bg-[#F7F6F3]"
                      title="Select every row matching the current search (across all pages)"
                    >
                      Select all{q ? ' matches' : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExcludedFor(filtered, true)}
                      className="px-3 py-2 text-xs text-[#D63B1F] border border-[rgba(214,59,31,0.2)] rounded-md hover:bg-[rgba(214,59,31,0.06)]"
                    >
                      Unselect all{q ? ' matches' : ''}
                    </button>
                    <div className="ml-auto px-3 py-2 bg-[#F7F6F3] border border-[#E3E1DB] rounded-md text-xs text-[#131210] font-medium whitespace-nowrap">
                      {selectedCount.toLocaleString()} / {chunkRecipients.length.toLocaleString()} selected
                    </div>
                  </div>

                  {/* Table */}
                  <div className="border border-[#E3E1DB] rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[36px_1fr_180px_120px] gap-2 px-3 py-2 bg-[#F7F6F3] text-[10px] uppercase tracking-wider text-[#9B9890] font-medium border-b border-[#E3E1DB]">
                      <span></span>
                      <span>Name</span>
                      <span>Phone</span>
                      <span>From column</span>
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: 'min(58vh, 520px)' }}>
                      {pageRows.length === 0 && (
                        <p className="px-3 py-6 text-xs text-[#9B9890] text-center">
                          {previewLoading ? 'Loading…' : (q ? 'No rows match your search.' : 'No recipients in this selection.')}
                        </p>
                      )}
                      {pageRows.map((r, i) => {
                        const checked = !excludedPhones.has(r.phone)
                        return (
                          <label
                            key={r.phone + i}
                            className={`grid grid-cols-[36px_1fr_180px_120px] gap-2 px-3 py-1.5 text-xs border-t border-[#F0EEE9] cursor-pointer hover:bg-[#F7F6F3] ${!checked ? 'opacity-60' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePhone(r.phone)}
                              className="w-4 h-4 accent-[#D63B1F]"
                            />
                            <span className="text-[#131210] truncate flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{r.name || '—'}</span>
                              {CONTACT_STATUS_MAP[r.status] && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold" style={{ color: CONTACT_STATUS_MAP[r.status].color, background: CONTACT_STATUS_MAP[r.status].bg }}>
                                  {CONTACT_STATUS_MAP[r.status].label}
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-[#5C5A55] truncate">{r.phone}</span>
                            <span className="text-[#9B9890] text-[10px] truncate">{r.sourceColumn}</span>
                          </label>
                        )
                      })}
                    </div>
                    {/* Pagination footer */}
                    {filtered.length > PAGE_SIZE && (
                      <div className="flex items-center justify-between px-3 py-2 border-t border-[#E3E1DB] bg-[#FAFAF8] text-xs">
                        <span className="text-[#5C5A55]">
                          Showing <strong>{(pageStart + 1).toLocaleString()}–{Math.min(pageStart + PAGE_SIZE, filtered.length).toLocaleString()}</strong> of {filtered.length.toLocaleString()}
                          {q && <span className="text-[#9B9890]"> (filtered)</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-2.5 py-1 border border-[#D4D1C9] rounded text-[#5C5A55] hover:bg-[#F7F6F3] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            ← Prev
                          </button>
                          <span className="text-[#5C5A55] font-mono">
                            Page {page} / {totalPages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="px-2.5 py-1 border border-[#D4D1C9] rounded text-[#5C5A55] hover:bg-[#F7F6F3] disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {previewTruncated && (
                    <p className="text-[11px] text-yellow-700 mt-2">
                      Showing first 50,000 recipients (capped). All selected recipients will still be sent.
                    </p>
                  )}

                  {errors.recipients && <p className="text-xs text-red-600 mt-2">{errors.recipients}</p>}
                  {errors.submit && (
                    <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{errors.submit}</div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ─── Step 4: Review & launch (summary + pricing) ─── */}
          {step === 4 && (() => {
            const vmCount = selectedRecipients.length
            const credits = vmCount * RVM_CREDITS_PER_VM
            const plan = PLAN_OVERAGE[subscription?.plan_name] || DEFAULT_OVERAGE
            const balance = Number(creditBalance || 0)
            const dollarValue = credits * plan.rate
            const overageCredits = Math.max(0, credits - balance)
            const leftAfter = Math.max(0, balance - credits)
            const usd = (n) => `$${n.toFixed(2)}`
            const tzLabel = TIMEZONES.find(t => t.id === resolvedTimezone)?.label || resolvedTimezone
            const scheduleText = whenMode === 'now' ? 'Send now'
              : whenMode === 'later' ? `Scheduled — ${startAtLocal || 'not set'} (${tzLabel})`
              : whenMode === 'best' ? `Best calling windows — Mon–Fri, 10–12 & 2–4 (${tzLabel})`
              : `Business hours — ${(resolvedSendWindows || []).map(w => `${w.start}–${w.end}`).join(', ')} (${tzLabel})`
            const speedText = throttleMode === 'recommended' ? `${selectedPreset.team} · ${selectedPreset.volume} voicemails/hr`
              : throttleMode === 'manual' ? `${resolvedThrottleCount} every ${throttleWindowValue} ${throttleUnit}${throttleWindowValue === 1 ? '' : 's'}`
              : 'No throttle — as fast as the carrier accepts'
            const rows = [
              ['Campaign', name || '—'],
              ['Sends from', senderNumber || '—'],
              ['Audio', uploadState && uploadState !== 'uploading' ? uploadState.name : '—'],
              ['Recipients', vmCount.toLocaleString()],
              ['Sending speed', speedText],
              ['When to send', scheduleText],
            ]
            return (
              <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-[#131210] mb-1">Review &amp; launch</h4>
                  <p className="text-xs text-[#9B9890]">Confirm the details and cost, then launch.</p>
                </div>
                <div className="border border-[#E3E1DB] rounded-lg divide-y divide-[#F0EEE9]">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
                      <span className="text-xs text-[#9B9890] uppercase tracking-wider flex-shrink-0">{k}</span>
                      <span className="text-sm text-[#131210] text-right break-words">{v}</span>
                    </div>
                  ))}
                </div>
                {uploadState && uploadState !== 'uploading' && (
                  <audio controls src={uploadState.url} className="w-full" style={{ height: 34 }} />
                )}

                {/* Cost — credits + their dollar value at the plan rate */}
                <div className="bg-[#131210] text-white rounded-lg p-4">
                  <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1">Campaign cost</p>
                      <p className="text-2xl font-semibold leading-none">{credits.toLocaleString()} <span className="text-base font-normal text-white/60">credits</span></p>
                      <p className="text-[11px] text-white/50 mt-1">{vmCount.toLocaleString()} voicemail{vmCount === 1 ? '' : 's'} × {RVM_CREDITS_PER_VM} credits</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold leading-none text-[#FF7A5C]">{usd(dollarValue)}</p>
                      <p className="text-[11px] text-white/50 mt-1">≈ at ${plan.rate.toFixed(2)}/credit · {plan.name}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/10 text-[11px] text-white/70 leading-relaxed">
                    {overageCredits === 0
                      ? <>Uses <strong className="text-white">{credits.toLocaleString()}</strong> of your <strong className="text-white">{balance.toLocaleString()}</strong> credits — <strong className="text-white">{leftAfter.toLocaleString()}</strong> left after this send.</>
                      : <>Your balance is <strong className="text-white">{balance.toLocaleString()}</strong> — <strong className="text-[#FF7A5C]">{overageCredits.toLocaleString()} short</strong>. Top up before launching.</>}
                  </div>
                </div>
                {errors.submit && (
                  <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{errors.submit}</div>
                )}
              </section>
            )
          })()}
        </div>
      </div>

      {/* Sticky bottom bar — matches the SMS New Campaign page */}
      <footer className="bg-[#FFFFFF] border-t border-[#E3E1DB] flex-shrink-0 px-4 sm:px-8 py-3 flex items-center justify-between">
        <button
          type="button"
          onClick={step === 1 ? onClose : goBack}
          className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] transition-colors"
        >
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 4 ? (
          <button
            type="button"
            onClick={goNext}
            className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg transition-colors"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleLaunch}
            disabled={isSubmitting || selectedRecipients.length === 0}
            className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg transition-colors disabled:opacity-50"
          >
            {isSubmitting
              ? <><i className="fas fa-spinner fa-spin mr-2" />Launching…</>
              : `Launch ${selectedRecipients.length.toLocaleString()} ${selectedRecipients.length === 1 ? 'recipient' : 'recipients'}`}
          </button>
        )}
      </footer>
    </div>
  )
}

function ViewRVMCampaignModal({ campaign: initialCampaign, contactLists, onClose, onLaunch, onDelete }) {
  // Live mirror of the campaign row. Polls while open so the progress counters
  // (sent_count / failed_count) and status (running/paused/completed) stay
  // current as the sweeper processes the queue — no refresh needed, and the
  // user can leave the tab open OR close it without affecting the campaign.
  const [campaign, setCampaign] = useState(initialCampaign)
  const [isLaunching, setIsLaunching] = useState(false)
  const [isTogglingPause, setIsTogglingPause] = useState(false)
  const [recipients, setRecipients] = useState([])
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [summary, setSummary] = useState(null)   // accurate uncapped counts
  const [tab, setTab] = useState('overview')   // 'overview' | 'recipients'

  // Poll the campaign row every 2.5s while it's mid-flight.
  // We stop polling once the campaign reaches a terminal state to spare cycles.
  useEffect(() => {
    setCampaign(initialCampaign)
  }, [initialCampaign?.id])

  useEffect(() => {
    const status = campaign?.status
    if (!campaign?.id || (status !== 'running' && status !== 'paused')) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await apiGet(`/api/voicemail-campaigns?id=${campaign.id}`)
        const data = await res.json()
        if (cancelled) return
        const fresh = (data?.campaigns || []).find(c => c.id === campaign.id)
        if (fresh) setCampaign(fresh)
      } catch { /* silent — next tick retries */ }
    }
    const handle = setInterval(tick, 2500)
    return () => { cancelled = true; clearInterval(handle) }
  }, [campaign?.id, campaign?.status])

  // Load per-recipient breakdown; re-poll while the campaign is still in flight
  // so each number's delivery status/time updates live.
  useEffect(() => {
    if (!campaign?.id) return
    let cancelled = false
    const load = async () => {
      try {
        if (recipients.length === 0) setRecipientsLoading(true)
        const res = await apiGet(`/api/voicemail-campaigns/${campaign.id}/recipients`)
        const data = await res.json()
        if (!cancelled && data?.success) {
          setRecipients(data.recipients || [])
          setSummary(data.summary || null)
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setRecipientsLoading(false) }
    }
    load()
    const inFlight = campaign.status === 'running' || campaign.status === 'paused'
    const handle = inFlight ? setInterval(load, 3000) : null
    return () => { cancelled = true; if (handle) clearInterval(handle) }
  }, [campaign?.id, campaign?.status])

  const getContactListName = (ids) => {
    if (!ids || !Array.isArray(ids) || ids.length === 0) return 'Unknown'
    const names = ids.map(id => contactLists.find(cl => cl.id === id)?.name).filter(Boolean)
    return names.length > 0 ? names.join(', ') : 'Unknown'
  }

  const formatDate = (dateString) => {
    try { return formatInTimeZone(new Date(dateString), 'UTC', 'MMM dd, yyyy HH:mm') }
    catch { return dateString }
  }

  const statusMap = {
    draft:     { label: 'Draft',     cls: 'bg-[#EFEDE8] text-[#5C5A55]' },
    running:   { label: 'Running',   cls: 'bg-blue-50 text-blue-700' },
    paused:    { label: 'Paused',    cls: 'bg-yellow-50 text-yellow-700' },
    completed: { label: 'Completed', cls: 'bg-green-50 text-green-700' },
    failed:    { label: 'Failed',    cls: 'bg-red-50 text-red-700' },
  }
  const statusLabel = statusMap[campaign.status]?.label || campaign.status
  const statusClass = statusMap[campaign.status]?.cls || 'bg-[#EFEDE8] text-[#5C5A55]'

  // Progress tracks dispatch (all handed to VoiceDrop). Delivered / Not
  // delivered come from VoiceDrop's webhook as a per-row overlay.
  // Prefer the recipients endpoint's UNCAPPED summary counts (accurate for
  // 15k+ lists and before total_recipients is set); fall back to the campaign
  // row's counters while the summary is still loading.
  const dispatched = Number(summary?.dispatched ?? campaign.sent_count ?? 0)   // handed to VoiceDrop
  const delivered = Number(summary?.delivered ?? campaign.delivered_count ?? 0)
  const failed = Number(summary?.failed ?? campaign.failed_count ?? 0)
  const total = Number(summary?.total ?? campaign.total_recipients ?? 0)
  // Progress tracks DISPATCH (everything handed to VoiceDrop). Delivery
  // confirmation overlays per-row but doesn't change the bar.
  const processed = dispatched
  const remaining = Math.max(0, total - processed)
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  // Daily-cap context (only when a per-day limit is set).
  const dailyCap = Number(summary?.dailyCap || campaign.daily_cap || 0)
  const sentToday = Number(summary?.sentToday || 0)
  const dailyCapReached = dailyCap > 0 && sentToday >= dailyCap && remaining > 0

  const handleLaunch = async () => {
    setIsLaunching(true)
    try { await onLaunch() }
    finally { setIsLaunching(false) }
  }

  const togglePause = async () => {
    const target = campaign.status === 'running' ? 'pause' : 'resume'
    setIsTogglingPause(true)
    try {
      const res = await apiPost(`/api/voicemail-campaigns/${campaign.id}/${target}`, {})
      const data = await res.json()
      if (res.ok && data.success && data.campaign) setCampaign(data.campaign)
    } finally {
      setIsTogglingPause(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-4xl my-8 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] bg-[#FFFFFF] flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[rgba(214,59,31,0.08)] rounded flex items-center justify-center">
              <i className="fas fa-voicemail text-[#D63B1F] text-xs"></i>
            </div>
            <h3 className="text-sm font-semibold text-[#131210]">RVM Campaign Details</h3>
          </div>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>

        {/* Name + status + tab switcher */}
        <div className="px-5 pt-3 pb-0 flex-shrink-0">
          <div className="flex items-center justify-between gap-4 mb-3">
            <p className="text-base font-semibold text-[#131210] truncate">{campaign.name}</p>
            <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium flex-shrink-0 ${statusClass}`}>{statusLabel}</span>
          </div>
          <div className="flex gap-5 border-b border-[#E3E1DB] -mx-5 px-5">
            {[
              { id: 'overview',   label: 'Overview' },
              { id: 'recipients', label: `Recipients${recipients.length ? ` (${recipients.length})` : ''}` },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`pb-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.id ? 'border-[#D63B1F] text-[#131210]' : 'border-transparent text-[#9B9890] hover:text-[#5C5A55]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {tab === 'overview' && (
          <>
          {/* Live progress — updates every few seconds via polling. */}
          {total > 0 && (
            <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg p-4">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <p className="text-[10px] text-[#9B9890] uppercase tracking-wider mb-0.5">Sent</p>
                  <p className="text-2xl font-semibold text-[#131210] leading-none">
                    {processed.toLocaleString()}
                    <span className="text-base font-normal text-[#9B9890]"> / {total.toLocaleString()} contacts</span>
                  </p>
                </div>
                <p className="text-2xl font-semibold text-[#D63B1F] leading-none">{pct}%</p>
              </div>
              <div className="w-full h-2.5 bg-[#EFEDE8] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${campaign.status === 'paused' ? 'bg-yellow-400' : campaign.status === 'completed' ? 'bg-green-500' : 'bg-[#D63B1F]'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px]">
                <span className="text-[#9B9890]">
                  {campaign.status === 'completed'
                    ? 'All contacts sent'
                    : campaign.status === 'paused'
                    ? `Paused · ${remaining.toLocaleString()} remaining`
                    : `${remaining.toLocaleString()} remaining`}
                </span>
                {/* Daily-limit context — how today's allowance is tracking. */}
                {dailyCap > 0 && (campaign.status === 'running' || campaign.status === 'paused') && (
                  <span className={dailyCapReached ? 'text-[#D63B1F] font-medium' : 'text-[#9B9890]'}>
                    {dailyCapReached
                      ? `Daily limit reached (${dailyCap.toLocaleString()}/day) — resumes tomorrow`
                      : `${sentToday.toLocaleString()} of ${dailyCap.toLocaleString()} sent today`}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Sent', value: dispatched, icon: 'fa-paper-plane', color: 'text-green-600' },
              { label: 'Delivered', value: delivered, icon: 'fa-check-circle', color: 'text-green-600' },
              { label: 'Not delivered', value: failed, icon: 'fa-times-circle', color: 'text-[#D63B1F]' },
            ].map(item => (
              <div key={item.label} className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg p-3 text-center">
                <i className={`fas ${item.icon} ${item.color} text-sm mb-1`}></i>
                <p className="text-lg font-semibold text-[#131210]">{item.value.toLocaleString()}</p>
                <p className="text-xs text-[#9B9890]">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Sender Number</p>
              <p className="text-sm text-[#5C5A55]">{campaign.sender_number}</p>
            </div>
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Sending Speed</p>
              <p className="text-sm text-[#5C5A55]">
                {campaign.throttle_count
                  ? (() => {
                      const w = campaign.throttle_window_seconds || 3600
                      const label = w % 86400 === 0 ? `${w / 86400} day` : w % 3600 === 0 ? `${w / 3600} hr` : `${Math.round(w / 60)} min`
                      return `${campaign.throttle_count.toLocaleString()} every ${label}`
                    })()
                  : 'No throttle'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Schedule</p>
              <p className="text-sm text-[#5C5A55]">
                {(() => {
                  const tz = campaign.send_timezone || 'America/New_York'
                  const parts = []
                  if (campaign.starts_at && new Date(campaign.starts_at) > new Date()) {
                    try { parts.push(`Starts ${formatInTimeZone(new Date(campaign.starts_at), tz, 'MMM dd, h:mm a zzz')}`) } catch {}
                  }
                  if (Array.isArray(campaign.send_windows) && campaign.send_windows.length > 0) {
                    const dayPart = Array.isArray(campaign.send_days) && campaign.send_days.length > 0 && campaign.send_days.length < 7
                      ? `${formatDays(campaign.send_days)} ` : ''
                    parts.push(`${dayPart}${campaign.send_windows.map(w => `${hhmm(w.start)}–${hhmm(w.end)}`).join(', ')} (${tz})`)
                  }
                  return parts.length ? parts.join(' · ') : 'Send now / Anytime'
                })()}
              </p>
            </div>
          </div>

          {campaign.recording_url && (
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-2">Voicemail Recording</p>
              <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg p-3">
                <audio controls src={campaign.recording_url} className="w-full" style={{ height: '36px' }} />
              </div>
            </div>
          )}
          </>
          )}

          {/* Recipients tab — each number, its delivery status, and time */}
          {tab === 'recipients' && (
            <div className="border border-[#E3E1DB] rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_140px_170px] gap-2 px-3 py-2 bg-[#F7F6F3] text-[10px] uppercase tracking-wider text-[#9B9890] font-medium border-b border-[#E3E1DB] sticky top-0">
                <span>Number</span>
                <span>Status</span>
                <span>Time (~ = estimated)</span>
              </div>
              {recipients.length === 0 && (
                <p className="px-3 py-6 text-xs text-[#9B9890] text-center">
                  {recipientsLoading ? 'Loading…' : 'No recipients yet.'}
                </p>
              )}
              {recipients.map((r, i) => {
                // 'sent' = dispatched to VoiceDrop (baseline success). Delivery
                // webhook later upgrades it to Delivered / Not delivered.
                const meta = {
                  delivered: { label: 'Delivered',    cls: 'bg-green-50 text-green-700',   t: r.delivered_at, est: false },
                  failed:    { label: 'Not delivered', cls: 'bg-red-50 text-red-600',       t: r.delivered_at || r.sent_at, est: false },
                  sent:      { label: 'Sent',          cls: 'bg-green-50 text-green-700',   t: r.sent_at, est: false },
                  sending:   { label: 'Sending…',      cls: 'bg-blue-50 text-blue-700',     t: r.estimated_at, est: true },
                  queued:    { label: 'Queued',        cls: 'bg-[#EFEDE8] text-[#5C5A55]',  t: r.estimated_at, est: true },
                  skipped:   { label: 'Skipped',       cls: 'bg-[#EFEDE8] text-[#9B9890]',  t: null, est: false },
                }[r.status] || { label: r.status, cls: 'bg-[#EFEDE8] text-[#5C5A55]', t: r.sent_at, est: false }
                const tz = campaign.send_timezone || 'America/New_York'
                let timeStr = '—'
                if (meta.t) {
                  try { timeStr = (meta.est ? '~' : '') + formatInTimeZone(new Date(meta.t), tz, 'MMM dd, h:mm a zzz') } catch {}
                }
                return (
                  <div key={r.phone + i} className="grid grid-cols-[1fr_140px_170px] gap-2 px-3 py-1.5 text-xs border-t border-[#F0EEE9] items-center">
                    <span className="font-mono text-[#131210] truncate" title={r.error || ''}>{r.phone}</span>
                    <span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                    </span>
                    <span className="text-[#9B9890] text-[11px]">{timeStr}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[#E3E1DB] px-5 py-3.5 flex flex-wrap items-center gap-2 flex-shrink-0">
          {campaign.status === 'draft' && (
            <button
              onClick={handleLaunch}
              disabled={isLaunching}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md transition-colors disabled:opacity-50"
            >
              {isLaunching ? <><i className="fas fa-spinner fa-spin text-xs"></i> Launching…</> : <><i className="fas fa-rocket text-xs"></i> Launch Campaign</>}
            </button>
          )}
          {(campaign.status === 'running' || campaign.status === 'paused') && (
            <button
              onClick={togglePause}
              disabled={isTogglingPause}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold rounded-md transition-colors disabled:opacity-50 ${
                campaign.status === 'running'
                  ? 'text-[#5C5A55] border border-[#D4D1C9] hover:bg-[#F7F6F3]'
                  : 'text-white bg-[#D63B1F] hover:bg-[#c23119]'
              }`}
            >
              {isTogglingPause
                ? <><i className="fas fa-spinner fa-spin text-xs"></i> {campaign.status === 'running' ? 'Pausing…' : 'Resuming…'}</>
                : campaign.status === 'running'
                  ? <><i className="fas fa-pause text-xs"></i> Pause</>
                  : <><i className="fas fa-play text-xs"></i> Resume</>}
            </button>
          )}
          <button onClick={onDelete} className="px-3 py-1.5 text-sm text-[#D63B1F] border border-[rgba(214,59,31,0.14)] rounded-md hover:bg-[rgba(214,59,31,0.07)]">Delete</button>
          <button onClick={onClose} className="ml-auto px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
        </div>
      </div>
    </div>
  )
}

function TrialUpsellModal({ subscription, user, onClose, onActivated }) {
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState(null)

  const trialEnd = subscription?.trial_end ? new Date(subscription.trial_end) : null
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000)) : null

  const handleActivate = async () => {
    setActivating(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/activate-now', { method: 'POST', headers: { 'x-workspace-id': user?.workspaceId } })
      const data = await res.json()
      if (data.success) { onActivated() }
      else { setError(data.error || 'Failed to activate. Please try again.') }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setActivating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-2xl shadow-2xl w-full max-w-md border border-[#E3E1DB] overflow-hidden">
        <div className="h-1 w-full bg-[#D63B1F]" />
        <div className="px-6 pt-7 pb-5 text-center border-b border-[#E3E1DB]">
          <div className="w-12 h-12 bg-[rgba(214,59,31,0.08)] rounded-full flex items-center justify-center mx-auto mb-4"><i className="fas fa-rocket text-[#D63B1F] text-lg"></i></div>
          <h2 className="text-[17px] font-semibold text-[#131210] tracking-tight mb-1.5">Campaigns require a paid subscription</h2>
          <p className="text-sm text-[#5C5A55] leading-relaxed">
            {daysLeft !== null ? `You have ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left on your trial — upgrade now to unlock campaigns before it ends.` : 'Upgrade your plan to start sending SMS campaigns to your contacts.'}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-widest mb-3">What you unlock</p>
          <ul className="space-y-2.5 mb-5">
            {[
              { icon: 'fa-paper-plane', text: 'Send SMS campaigns to all your contacts instantly' },
              { icon: 'fa-chart-line', text: 'Track delivery, open, and reply rates in real time' },
              { icon: 'fa-clock', text: 'Schedule campaigns to send at the perfect time' },
              { icon: 'fa-headset', text: 'Priority support from our team' },
            ].map(({ icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-[rgba(214,59,31,0.08)] flex items-center justify-center flex-shrink-0"><i className={`fas ${icon} text-[#D63B1F] text-[11px]`}></i></div>
                <span className="text-sm text-[#5C5A55]">{text}</span>
              </li>
            ))}
          </ul>
          {error && <div className="mb-4 px-3 py-2.5 bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.18)] text-[#D63B1F] rounded-lg text-xs">{error}</div>}
          <button onClick={handleActivate} disabled={activating} className="w-full py-3 text-sm font-semibold text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {activating ? <><i className="fas fa-spinner fa-spin"></i> Activating…</> : <><i className="fas fa-bolt"></i> Activate Now &amp; Start Sending</>}
          </button>
          <button onClick={onClose} className="w-full mt-2.5 py-2 text-sm text-[#9B9890] hover:text-[#5C5A55] transition-colors">Continue trial</button>
        </div>
      </div>
    </div>
  )
}

function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">{title}</h3></div>
        <div className="px-5 py-4"><p className="text-sm text-[#5C5A55]">{message}</p></div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmationModal({ campaignName, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">Delete Campaign</h3></div>
        <div className="px-5 py-4"><p className="text-sm text-[#5C5A55]">Delete <span className="font-medium text-[#131210]">"{campaignName}"</span>? This cannot be undone.</p></div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c4351b] rounded-md">Delete</button>
        </div>
      </div>
    </div>
  )
}
