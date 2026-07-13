// app/campaigns/page.jsx
'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import SearchableDropdown from '@/components/SearchableDropdown'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, apiPut, apiDelete, fetchWithWorkspace } from '@/lib/api-client'
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

// Compact "how long ago" from a timestamp: "12m ago", "5h ago", "3d ago".
function timeAgo(ts) {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  if (!Number.isFinite(ms)) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
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

// Reverse-map a saved voicemail_campaigns row back into the RVM wizard's UI
// state so a DRAFT can be reopened and edited. The wizard stores schedule/throttle
// as UI *modes*; the row stores the *resolved* values — so we infer the closest
// mode. Recipients are NOT restored here: once the lists/columns are prefilled the
// preview effect re-derives the audience (Step 3), where the user re-confirms it.
function deriveRvmWizardInit(c) {
  const D = {
    name: '', senderNumber: '', uploadState: null,
    selectedListIds: [], selectedColumns: ['phone_number'],
    throttleMode: 'recommended', presetId: 'small', throttleCount: 100, throttleWindowValue: 15, throttleUnit: 'minute',
    whenMode: 'now', startAtLocal: '', sendTimezone: 'America/New_York',
    dailyLimitEnabled: false, dailyLimit: 500,
    monitorInput: '', excludeStatuses: DEFAULT_EXCLUDED_STATUSES,
  }
  if (!c) return D

  const uploadState = (c.recording_url || c.voicedrop_recording_url)
    ? { url: c.recording_url || c.voicedrop_recording_url, voicedropUrl: c.voicedrop_recording_url || null, path: c.recording_path || null, name: c.recording_name || 'Saved recording' }
    : null

  // Throttle → mode. null count = "max"; otherwise "manual" with the saved
  // count and the largest clean unit for the window.
  let throttleMode = 'manual', throttleCount = 100, throttleWindowValue = 15, throttleUnit = 'minute'
  if (c.throttle_count == null) {
    throttleMode = 'max'
  } else {
    throttleCount = c.throttle_count
    const sec = c.throttle_window_seconds || 3600
    if (sec % 86400 === 0)      { throttleWindowValue = sec / 86400; throttleUnit = 'day' }
    else if (sec % 3600 === 0)  { throttleWindowValue = sec / 3600;  throttleUnit = 'hour' }
    else                        { throttleWindowValue = Math.max(1, Math.round(sec / 60)); throttleUnit = 'minute' }
  }

  // Schedule → when. send_windows present ⇒ best/business; else future start ⇒
  // later; else now.
  const sendTimezone = c.send_timezone || 'America/New_York'
  let whenMode = 'now', startAtLocal = ''
  const w = Array.isArray(c.send_windows) ? c.send_windows : null
  if (w && w.length > 0) {
    const norm = w.map(x => `${hhmm(x.start)}-${hhmm(x.end)}`).join(',')
    const bestNorm = SCHEDULE_PRESETS.best.map(x => `${x.start}-${x.end}`).join(',')
    whenMode = norm === bestNorm ? 'best' : 'business'
  } else if (c.starts_at && new Date(c.starts_at).getTime() > Date.now()) {
    whenMode = 'later'
    try { startAtLocal = formatInTimeZone(new Date(c.starts_at), sendTimezone, "yyyy-MM-dd'T'HH:mm") } catch {}
  }

  return {
    name: c.name || '',
    senderNumber: c.sender_number || '',
    uploadState,
    selectedListIds: Array.isArray(c.contact_list_ids) ? c.contact_list_ids : [],
    selectedColumns: Array.isArray(c.phone_columns) && c.phone_columns.length ? c.phone_columns : ['phone_number'],
    throttleMode, presetId: 'small', throttleCount, throttleWindowValue, throttleUnit,
    whenMode, startAtLocal, sendTimezone,
    dailyLimitEnabled: !!(c.daily_cap && c.daily_cap > 0),
    dailyLimit: c.daily_cap && c.daily_cap > 0 ? c.daily_cap : 500,
    monitorInput: Array.isArray(c.monitor_numbers) ? c.monitor_numbers.join('\n') : '',
    excludeStatuses: Array.isArray(c.exclude_statuses) ? c.exclude_statuses : [],
  }
}

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
  const [editRVMCampaign, setEditRVMCampaign] = useState(null)   // draft being edited in the wizard
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
                                : campaign.source === 'sheets'
                                ? (campaign.sheet_name || 'Google Sheet')
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
                              ) : campaign.source === 'sheets' ? (
                                <span className="inline-flex items-center gap-1.5">
                                  {campaign.sheet_name || 'Google Sheet'}
                                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#9B9890] bg-[#EFEDE8] px-1.5 py-0.5 rounded">Sheet</span>
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

      {(showCreateRVM || editRVMCampaign) && (
        <CreateRVMCampaignModal
          contactLists={contactLists}
          phoneNumbers={phoneNumbers}
          subscription={subscription}
          creditBalance={creditBalance}
          editCampaign={editRVMCampaign}
          onClose={() => { setShowCreateRVM(false); setEditRVMCampaign(null) }}
          onCreated={() => { setShowCreateRVM(false); setEditRVMCampaign(null); fetchRVMCampaigns() }}
        />
      )}

      {showViewRVM && selectedRVMCampaign && (
        <ViewRVMCampaignModal
          campaign={selectedRVMCampaign}
          contactLists={contactLists}
          onClose={() => { setShowViewRVM(false); setSelectedRVMCampaign(null) }}
          onEdit={() => { setShowViewRVM(false); setEditRVMCampaign(selectedRVMCampaign); setSelectedRVMCampaign(null) }}
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
  const [bizHours, setBizHours] = useState(null)   // workspace Business Hours (Settings)
  useEffect(() => {
    fetchWithWorkspace('/api/workspace/business-hours').then(r => r.json()).then(setBizHours).catch(() => {})
  }, [])
  const CAMPAIGN_DEFAULTS = {
    name: '', message: '', contactListId: '', phoneNumberId: '',
    scheduleTime: '', scheduleType: 'immediate',
    // Sending pace & limits
    dailyLimitEnabled: false, dailyCap: 500,
    businessHoursOnly: false,
    recurring: false,
    // Phase 2 — Monday source
    source: 'contacts',          // 'contacts' | 'monday' | 'sheets'
    mondayBoardId: '', mondayBoardName: '',
    mondayGroupIds: [],          // empty array == "all groups"
    mondayPhoneColumnId: '',
    mondayItemIds: [],           // selected rows; all-selected == "all items"
    mondayFilters: [],           // [{ columnId, values: [] }] — AND across, OR within
    // Phase 3 — Google Sheets source
    sheetSpreadsheetId: '', sheetSpreadsheetName: '',
    sheetTabId: null, sheetTabName: '',
    sheetPhoneColumn: '',
    sheetRowIds: [],             // selected rows; all-selected == "all rows"
    // Engagement-based recipient filters — enforced server-side at send time
    // against the sender line's conversation history.
    filterEngagement: 'all',     // 'all' | 'not_replied' | 'not_replied_recent' | 'replied' | 'never_messaged'
    filterWindowHours: 24,       // window for 'not_replied_recent'
    filterQuietHours: 0,         // "skip anyone texted in the last N hours" (0 = off)
    filterExcludeStatuses: [],
  }
  // "New Campaign" ALWAYS starts blank — the wizard no longer auto-restores
  // in-progress work (opening a stale half-built campaign surprised users).
  // To keep work for later, use "Save as draft": DB drafts open from the list.
  const DRAFT_KEY = 'campaign.wizard.draft'
  const [formData, setFormData] = useState(CAMPAIGN_DEFAULTS)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [created, setCreated] = useState(false)
  const [step, setStep] = useState(1)
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch {} }
  // Remove any legacy autosave so it can never resurface.
  useEffect(() => { clearDraft() }, [])
  const startOver = () => { clearDraft(); setFormData(CAMPAIGN_DEFAULTS); setStep(1); setErrors({}) }

  // Inline CSV → new contact list (no leaving the wizard). Locally-created lists
  // are merged into the picker and become reusable in Contacts.
  const [extraLists, setExtraLists] = useState([])
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvListName, setCsvListName] = useState('')
  const [csvBusy, setCsvBusy] = useState(false)
  const [csvError, setCsvError] = useState('')
  const handleCsvImport = async () => {
    if (!csvFile) { setCsvError('Choose a CSV file.'); return }
    const listName = csvListName.trim() || csvFile.name.replace(/\.csv$/i, '') || 'Imported list'
    setCsvBusy(true); setCsvError('')
    try {
      const listRes = await apiPost('/api/contact-lists', { name: listName })
      const listData = await listRes.json()
      const listId = listData?.contactList?.id || listData?.id
      if (!listId) { setCsvError(listData?.error || 'Could not create the list.'); return }
      const fd = new FormData()
      fd.append('file', csvFile)
      fd.append('contact_list_id', listId)
      const impRes = await fetchWithWorkspace('/api/contacts/import', { method: 'POST', body: fd })
      const impData = await impRes.json()
      if (!impRes.ok || !impData?.success) { setCsvError(impData?.error || 'Import failed — make sure the CSV has a phone and a name column.'); return }
      const imported = impData.imported || 0
      setExtraLists(prev => [{ id: listId, name: listName, contactCount: imported }, ...prev])
      setFormData(f => ({ ...f, contactListId: listId }))
      setCsvOpen(false); setCsvFile(null); setCsvListName('')
    } catch {
      setCsvError('Upload failed. Please try again.')
    } finally {
      setCsvBusy(false)
    }
  }
  const lastAdvanceRef = useRef(0)           // when we last advanced a step (ghost-click guard)
  const messageRef = useRef(null)

  // Monday integration state
  const [mondayConnected, setMondayConnected] = useState(false)
  const [mondayBoards, setMondayBoards] = useState([])
  const [mondayGroups, setMondayGroups] = useState([])
  const [mondayColumns, setMondayColumns] = useState([])
  const [mondayItems, setMondayItems] = useState([])
  const [mondayItemSearch, setMondayItemSearch] = useState('')
  const [mondayItemPage, setMondayItemPage] = useState(0)   // paginate the picker so 1000s of rows don't all render
  const [mondayFetch, setMondayFetch] = useState({ fetched: 0, total: 0 })   // live fetch progress
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
    let cancelled = false
    const run = async () => {
      setMondayItems([])
      setMondayItemSearch('')
      setMondayItemPage(0)
      setMondayLoading(p => ({ ...p, items: true }))
      const boardTotal = mondayBoards.find(b => String(b.id) === String(formData.mondayBoardId))?.items_count || 0
      setMondayFetch({ fetched: 0, total: boardTotal })

      // Fetch one GROUP per request, in parallel — Monday pages ~5s each, so
      // paging the board's groups concurrently is ~6× faster than one cursor
      // chain. "All groups" (none picked) → every group on the board.
      const groupsToFetch = formData.mondayGroupIds.length > 0
        ? formData.mondayGroupIds
        : mondayGroups.map(g => g.id)

      let acc = []
      const fetchOne = async (gid) => {
        const qs = new URLSearchParams()
        qs.set('phone_column_id', formData.mondayPhoneColumnId)
        if (gid) qs.set('group', gid)
        const res = await fetchWithWorkspace(`/api/integrations/monday/boards/${formData.mondayBoardId}/items?${qs}`)
        const d = await res.json()
        if (cancelled) return
        acc = acc.concat(d?.items || [])
        setMondayItems([...acc])
        setMondayFetch(prev => ({ fetched: acc.length, total: Math.max(prev.total, acc.length) }))
      }

      try {
        if (groupsToFetch.length === 0) {
          await fetchOne(null)   // board with no groups → whole board
        } else {
          const CONCURRENCY = 8   // safe under Monday's limits with light queries
          const queue = [...groupsToFetch]
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            while (queue.length && !cancelled) {
              const gid = queue.shift()
              try { await fetchOne(gid) } catch { /* skip a failed group, keep the rest */ }
            }
          }))
        }
        if (!cancelled) setFormData(f => ({ ...f, mondayItemIds: acc.map(i => i.id), mondayFilters: [] }))
      } catch {
        if (!cancelled) { setMondayItems([]); setFormData(f => ({ ...f, mondayItemIds: [] })) }
      } finally {
        if (!cancelled) setMondayLoading(p => ({ ...p, items: false }))
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.source, formData.mondayBoardId, formData.mondayGroupIds.join(','), formData.mondayPhoneColumnId, mondayGroups.map(g => g.id).join(',')])

  // Google Sheets integration state
  const [sheetsConnected, setSheetsConnected] = useState(false)
  const [sheetsSpreadsheets, setSheetsSpreadsheets] = useState([])
  const [sheetsTabs, setSheetsTabs] = useState([])
  const [sheetsColumns, setSheetsColumns] = useState([])
  const [sheetsRows, setSheetsRows] = useState([])
  const [sheetsRowSearch, setSheetsRowSearch] = useState('')
  const [sheetsRowPage, setSheetsRowPage] = useState(0)   // paginate the picker so 1000s of rows don't all render
  const [sheetsLoading, setSheetsLoading] = useState({ spreadsheets: false, tabs: false, columns: false, rows: false })

  // Fetch connection status on mount — gates whether the Sheets source option is shown.
  useEffect(() => {
    let alive = true
    fetchWithWorkspace('/api/integrations/google-sheets')
      .then(r => r.json())
      .then(d => { if (alive) setSheetsConnected(!!d?.connected) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Prefetch spreadsheets as soon as we know Sheets is connected — same
  // rationale as the Monday boards prefetch above.
  useEffect(() => {
    if (!sheetsConnected || sheetsSpreadsheets.length > 0) return
    setSheetsLoading(p => ({ ...p, spreadsheets: true }))
    fetchWithWorkspace('/api/integrations/google-sheets/spreadsheets')
      .then(r => r.json())
      .then(d => setSheetsSpreadsheets(d?.spreadsheets || []))
      .catch(() => setSheetsSpreadsheets([]))
      .finally(() => setSheetsLoading(p => ({ ...p, spreadsheets: false })))
  }, [sheetsConnected, sheetsSpreadsheets.length])

  // Fetch tabs when a spreadsheet is selected. Reset first so stale tabs from
  // a previously-picked spreadsheet can't slip through.
  useEffect(() => {
    if (!formData.sheetSpreadsheetId) {
      setSheetsTabs([]); setSheetsColumns([])
      return
    }
    setSheetsLoading(p => ({ ...p, tabs: true }))
    setSheetsTabs([])
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${formData.sheetSpreadsheetId}/tabs`)
      .then(r => r.json())
      .then(d => setSheetsTabs(d?.tabs || []))
      .catch(() => setSheetsTabs([]))
      .finally(() => setSheetsLoading(p => ({ ...p, tabs: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.sheetSpreadsheetId])

  // Fetch columns when a tab is selected. Auto-select the first phone-looking
  // column if the user hasn't picked one yet (mirrors the Monday behavior).
  useEffect(() => {
    if (!formData.sheetSpreadsheetId || !formData.sheetTabName) {
      setSheetsColumns([])
      return
    }
    setSheetsLoading(p => ({ ...p, columns: true }))
    setSheetsColumns([])
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${formData.sheetSpreadsheetId}/columns?sheet=${encodeURIComponent(formData.sheetTabName)}`)
      .then(r => r.json())
      .then(d => {
        const cols = d?.columns || []
        setSheetsColumns(cols)
        const phoneCol = cols.find(c => c.isPhoneType)
        if (phoneCol && !formData.sheetPhoneColumn) {
          setFormData(f => ({ ...f, sheetPhoneColumn: phoneCol.id }))
        }
      })
      .catch(() => setSheetsColumns([]))
      .finally(() => setSheetsLoading(p => ({ ...p, columns: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.sheetSpreadsheetId, formData.sheetTabName])

  // Fetch the tab's rows once spreadsheet, tab and phone column are set, so
  // the user can pick which rows to send to. Default selection = all rows
  // (rows missing a phone are skipped at send time by the backend).
  useEffect(() => {
    if (formData.source !== 'sheets' || !formData.sheetSpreadsheetId || !formData.sheetTabName || !formData.sheetPhoneColumn) {
      setSheetsRows([])
      return
    }
    let cancelled = false
    setSheetsRows([])
    setSheetsRowSearch('')
    setSheetsRowPage(0)
    setSheetsLoading(p => ({ ...p, rows: true }))
    const qs = new URLSearchParams()
    qs.set('sheet', formData.sheetTabName)
    qs.set('phone_column', formData.sheetPhoneColumn)
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${formData.sheetSpreadsheetId}/rows?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const rows = d?.rows || []
        setSheetsRows(rows)
        setFormData(f => ({ ...f, sheetRowIds: rows.map(row => row.id) }))
      })
      .catch(() => { if (!cancelled) { setSheetsRows([]); setFormData(f => ({ ...f, sheetRowIds: [] })) } })
      .finally(() => { if (!cancelled) setSheetsLoading(p => ({ ...p, rows: false })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.source, formData.sheetSpreadsheetId, formData.sheetTabName, formData.sheetPhoneColumn])

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

  // Engagement filters → the API shape. null = "no filtering", so the backend
  // skips the history check entirely.
  const buildRecipientFilters = () => {
    if (formData.filterEngagement === 'all' && Number(formData.filterQuietHours) === 0) return null
    return {
      engagement: formData.filterEngagement,
      window_hours: Number(formData.filterWindowHours),
      skip_contacted_hours: Number(formData.filterQuietHours),
      exclude_statuses: [],
    }
  }

  // Recipients preview (contacts source) — fetched when the user reaches Review,
  // and refetched whenever the list, sender or filters change. Filters are
  // enforced server-side at send time; this shows who matches right now.
  const [recipPreview, setRecipPreview] = useState(null)   // { total, matched, excluded, truncated, recipients }
  const [recipPreviewLoading, setRecipPreviewLoading] = useState(false)
  const [recipPreviewError, setRecipPreviewError] = useState('')
  const [recipSearch, setRecipSearch] = useState('')
  useEffect(() => {
    if (step !== 4 || formData.source !== 'contacts' || !formData.contactListId) {
      setRecipPreview(null); setRecipPreviewError('')
      return
    }
    const selectedPn = phoneNumbers.find(pn => pn.id === formData.phoneNumberId)
    const senderNumber = selectedPn?.phone_number || selectedPn?.phoneNumber || ''
    let alive = true
    setRecipPreviewLoading(true)
    setRecipPreviewError('')
    setRecipSearch('')
    fetchWithWorkspace('/api/campaigns/preview-recipients', {
      method: 'POST',
      body: JSON.stringify({
        contact_list_ids: [formData.contactListId],
        sender_number: senderNumber,
        filters: {
          engagement: formData.filterEngagement,
          window_hours: Number(formData.filterWindowHours),
          skip_contacted_hours: Number(formData.filterQuietHours),
          exclude_statuses: [],
        },
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (d?.success) setRecipPreview(d)
        else { setRecipPreview(null); setRecipPreviewError(d?.error || 'Could not load the recipient preview.') }
      })
      .catch(() => { if (alive) { setRecipPreview(null); setRecipPreviewError('Could not load the recipient preview.') } })
      .finally(() => { if (alive) setRecipPreviewLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, formData.source, formData.contactListId, formData.phoneNumberId, formData.filterEngagement, formData.filterWindowHours, formData.filterQuietHours])

  const contactListOptions = [...extraLists, ...contactLists].map(cl => ({ value: cl.id, label: cl.name, count: cl.contactCount ?? cl.contact_count ?? 0, searchText: cl.name }))
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

  // Search + paginate the picker so a 3000-row board doesn't render all at once.
  const MONDAY_ITEMS_PER_PAGE = 100
  const searchedPool = (() => {
    const q = mondayItemSearch.trim().toLowerCase()
    if (!q) return recipientPool
    return recipientPool.filter(it => (it.name || '').toLowerCase().includes(q) || (it.phone || '').toLowerCase().includes(q))
  })()
  const mondayItemPageCount = Math.max(1, Math.ceil(searchedPool.length / MONDAY_ITEMS_PER_PAGE))
  const mondayItemPageClamped = Math.min(mondayItemPage, mondayItemPageCount - 1)
  const visibleMondayItems = searchedPool.slice(mondayItemPageClamped * MONDAY_ITEMS_PER_PAGE, (mondayItemPageClamped + 1) * MONDAY_ITEMS_PER_PAGE)

  // Search + paginate the sheet-row picker (mirrors the Monday items picker).
  const SHEET_ROWS_PER_PAGE = 100
  const searchedSheetRows = (() => {
    const q = sheetsRowSearch.trim().toLowerCase()
    if (!q) return sheetsRows
    return sheetsRows.filter(r => (r.name || '').toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q))
  })()
  const sheetsRowPageCount = Math.max(1, Math.ceil(searchedSheetRows.length / SHEET_ROWS_PER_PAGE))
  const sheetsRowPageClamped = Math.min(sheetsRowPage, sheetsRowPageCount - 1)
  const visibleSheetRows = searchedSheetRows.slice(sheetsRowPageClamped * SHEET_ROWS_PER_PAGE, (sheetsRowPageClamped + 1) * SHEET_ROWS_PER_PAGE)

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
      } else if (formData.source === 'sheets') {
        if (!formData.sheetSpreadsheetId) e.sheetSpreadsheetId = 'Spreadsheet is required'
        if (!formData.sheetTabName) e.sheetTabName = 'Sheet tab is required'
        if (!formData.sheetPhoneColumn) e.sheetPhoneColumn = 'Phone number column is required'
        if (sheetsRows.length > 0 && formData.sheetRowIds.length === 0) e.sheetRowIds = 'Select at least one recipient.'
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

  const goNext = () => { if (validateStep(step)) { lastAdvanceRef.current = Date.now(); setStep(s => Math.min(4, s + 1)) } }
  const goBack = () => { setErrors({}); setStep(s => Math.max(1, s - 1)) }

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Campaign name is required'
    if (!formData.message.trim()) newErrors.message = 'Message is required'
    if (formData.source === 'contacts') {
      if (!formData.contactListId) newErrors.contactListId = 'Contact list is required'
    } else if (formData.source === 'sheets') {
      if (!formData.sheetSpreadsheetId) newErrors.sheetSpreadsheetId = 'Spreadsheet is required'
      if (!formData.sheetTabName) newErrors.sheetTabName = 'Sheet tab is required'
      if (!formData.sheetPhoneColumn) newErrors.sheetPhoneColumn = 'Phone number column is required'
      if (sheetsRows.length > 0 && formData.sheetRowIds.length === 0) {
        newErrors.sheetRowIds = 'Select at least one recipient.'
      }
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

  // Save-as-draft: persist whatever's filled (only a name is required) as a
  // draft campaign in the list, to finish & launch later. Clears local autosave.
  const handleSaveDraft = async () => {
    if (!formData.name.trim()) { setErrors({ name: 'Name the campaign to save a draft.' }); setStep(1); return }
    setIsSubmitting(true)
    setErrors({})
    try {
      const selectedPn = phoneNumbers.find(pn => pn.id === formData.phoneNumberId)
      const senderNumber = selectedPn?.phone_number || selectedPn?.phoneNumber || ''
      const res = await apiPost('/api/campaigns', {
        draft: true,
        name: formData.name,
        message_template: formData.message,
        sender_number: senderNumber,
        source: formData.source,
        contact_list_ids: formData.source === 'contacts' && formData.contactListId ? [formData.contactListId] : [],
        scheduled_at: formData.scheduleType === 'scheduled' && formData.scheduleTime ? new Date(formData.scheduleTime).toISOString() : null,
        daily_cap: formData.dailyLimitEnabled ? (Number(formData.dailyCap) || null) : null,
        send_windows: formData.businessHoursOnly && bizHours ? [{ start: (bizHours.start || '09:00:00').slice(0, 5), end: (bizHours.end || '18:00:00').slice(0, 5) }] : null,
        send_days: formData.businessHoursOnly && bizHours ? bizHours.days : null,
        send_timezone: formData.businessHoursOnly && bizHours ? bizHours.tz : null,
        recurring: !!(formData.recurring && formData.dailyLimitEnabled),
        recipient_filters: buildRecipientFilters(),
      })
      const data = await res.json()
      if (!data.success) { setErrors({ submit: data.error || 'Failed to save draft' }); return }
      if (formData.source === 'monday' && formData.mondayBoardId) {
        const newId = data.campaign?.id || data.id
        const allSelected = mondayItems.length > 0 && formData.mondayItemIds.length === mondayItems.length
        if (newId) await fetchWithWorkspace(`/api/campaigns/${newId}/monday-link`, {
          method: 'POST',
          body: JSON.stringify({ board_id: formData.mondayBoardId, board_name: formData.mondayBoardName, group_ids: formData.mondayGroupIds, item_ids: allSelected ? [] : formData.mondayItemIds, phone_column_id: formData.mondayPhoneColumnId }),
        }).catch(() => {})
      }
      if (formData.source === 'sheets' && formData.sheetSpreadsheetId) {
        const newId = data.campaign?.id || data.id
        const allSelected = sheetsRows.length > 0 && formData.sheetRowIds.length === sheetsRows.length
        if (newId) await fetchWithWorkspace(`/api/campaigns/${newId}/sheets-link`, {
          method: 'POST',
          body: JSON.stringify({ spreadsheet_id: formData.sheetSpreadsheetId, spreadsheet_name: formData.sheetSpreadsheetName, sheet_id: formData.sheetTabId, sheet_name: formData.sheetTabName, phone_column: formData.sheetPhoneColumn, row_ids: allSelected ? [] : formData.sheetRowIds }),
        }).catch(() => {})
      }
      clearDraft()
      onCampaignCreated()
    } catch {
      setErrors({ submit: 'Failed to save draft. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Safety net: NEVER create the campaign before the Review step. If a submit
    // fires early (implicit form submit, Enter key, etc.) just advance the wizard
    // so the user always sees Review before anything is created/scheduled.
    if (step < 4) { goNext(); return }
    // Ghost-click guard: the "Next" click that advanced us to Review can land on
    // the Create/Schedule button that just rendered in the same spot. Ignore any
    // submit that fires right after a step advance.
    if (Date.now() - lastAdvanceRef.current < 600) return
    if (!validateForm()) return
    setIsSubmitting(true)
    try {
      const selectedPn = phoneNumbers.find(pn => pn.id === formData.phoneNumberId)
      const senderNumber = selectedPn?.phone_number || selectedPn?.phoneNumber

      // Monday/Sheets-sourced campaigns still get a (synthetic empty)
      // contact_list_ids because the column is NOT NULL in the schema. The send
      // loop checks for a link row first and ignores contact_list_ids when one
      // is present.
      const payload = {
        name: formData.name,
        message_template: formData.message,
        contact_list_ids: formData.source === 'contacts' ? [formData.contactListId] : [],
        sender_number: senderNumber,
        delay_between_messages: 1000,
        // "Schedule for later" — store the chosen time; the queue cron sends then.
        scheduled_at: formData.scheduleType === 'scheduled' && formData.scheduleTime
          ? new Date(formData.scheduleTime).toISOString()
          : null,
        // Sending pace & limits → the cron sweeper gates on these.
        daily_cap: formData.dailyLimitEnabled ? (Number(formData.dailyCap) || null) : null,
        send_windows: formData.businessHoursOnly && bizHours
          ? [{ start: (bizHours.start || '09:00:00').slice(0, 5), end: (bizHours.end || '18:00:00').slice(0, 5) }]
          : null,
        send_days: formData.businessHoursOnly && bizHours ? bizHours.days : null,
        send_timezone: formData.businessHoursOnly && bizHours ? bizHours.tz : null,
        recurring: !!(formData.recurring && formData.dailyLimitEnabled),
        // Engagement filters — re-checked server-side at send time (null = none).
        recipient_filters: buildRecipientFilters(),
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

      // If Google Sheets source, persist the link to the new campaign.
      if (formData.source === 'sheets') {
        const newCampaignId = data.campaign?.id || data.id || data.campaignId
        if (!newCampaignId) {
          setErrors({ submit: 'Campaign created but ID was missing — refresh and link the sheet manually.' })
          return
        }
        // If every row is selected, send row_ids empty → stored as "all", so
        // rows added to the sheet later are still included. Otherwise lock in
        // the explicit subset the user picked.
        const allSelected =
          sheetsRows.length > 0 && formData.sheetRowIds.length === sheetsRows.length
        const linkRes = await fetchWithWorkspace(`/api/campaigns/${newCampaignId}/sheets-link`, {
          method: 'POST',
          body: JSON.stringify({
            spreadsheet_id: formData.sheetSpreadsheetId,
            spreadsheet_name: formData.sheetSpreadsheetName,
            sheet_id: formData.sheetTabId,
            sheet_name: formData.sheetTabName,
            phone_column: formData.sheetPhoneColumn,
            row_ids: allSelected ? [] : formData.sheetRowIds,
          }),
        })
        const linkData = await linkRes.json()
        if (!linkRes.ok || !linkData.success) {
          setErrors({ submit: `Campaign created but linking the Google Sheet failed: ${linkData.error || 'unknown error'}` })
          return
        }
      }

      clearDraft()
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => { setErrors({}); setFormData(f => ({ ...f, source: 'contacts' })) }}
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
                  onClick={() => { if (mondayConnected) { setErrors({}); setFormData(f => ({ ...f, source: 'monday' })) } }}
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
                <button
                  type="button"
                  onClick={() => { if (sheetsConnected) { setErrors({}); setFormData(f => ({ ...f, source: 'sheets' })) } }}
                  disabled={!sheetsConnected}
                  title={sheetsConnected ? '' : 'Connect Google Sheets in Settings → Integrations first'}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border text-left transition-colors ${formData.source === 'sheets' ? 'bg-[#fdecea] border-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] hover:bg-[#F7F6F3]'} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#FFFFFF]`}
                >
                  <svg width="18" height="18" viewBox="0 0 32 32" fill="none" className="mt-0.5 shrink-0">
                    <path d="M8 2h12l6 6v20a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#0F9D58" />
                    <path d="M20 2l6 6h-6V2z" fill="#87CEAC" />
                    <path d="M11 14h10v9H11v-9zm2 2v1.5h2.5V16H13zm4.5 0v1.5H20V16h-2.5zM13 19.5V21h2.5v-1.5H13zm4.5 0V21H20v-1.5h-2.5z" fill="#FFFFFF" />
                  </svg>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${formData.source === 'sheets' ? 'text-[#D63B1F]' : 'text-[#131210]'}`}>Google Sheet</span>
                    <span className="block text-xs text-[#9B9890] mt-0.5">Send from a Google Sheet tab</span>
                  </span>
                </button>
              </div>
              {!mondayConnected && (
                <p className="text-[11px] text-[#9B9890] mt-2">
                  Connect <a href="/settings?section=integrations" className="text-[#D63B1F] hover:underline">Monday.com</a> to send campaigns from a board.
                </p>
              )}
              {!sheetsConnected && (
                <p className="text-[11px] text-[#9B9890] mt-2">
                  Connect <a href="/settings?section=integrations" className="text-[#D63B1F] hover:underline">Google Sheets</a> to send campaigns from a sheet.
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

                {/* Upload a CSV → new reusable list, without leaving the wizard */}
                {!csvOpen ? (
                  <button type="button" onClick={() => { setCsvOpen(true); setCsvError('') }} className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#D63B1F] hover:underline">
                    <i className="fas fa-upload text-[11px]" /> Upload a CSV as a new list
                  </button>
                ) : (
                  <div className="mt-3 p-3.5 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[#5C5A55]">Import contacts from CSV</p>
                      <button type="button" onClick={() => { setCsvOpen(false); setCsvFile(null); setCsvError('') }} className="text-[#9B9890] hover:text-[#5C5A55]"><i className="fas fa-times text-xs" /></button>
                    </div>
                    <input type="text" value={csvListName} onChange={(e) => setCsvListName(e.target.value)} placeholder="New list name (defaults to file name)"
                      className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20" />
                    <input type="file" accept=".csv,text/csv" onChange={(e) => { setCsvFile(e.target.files?.[0] || null); setCsvError('') }}
                      className="block w-full text-xs text-[#5C5A55] file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-[#EFEDE8] file:text-[#5C5A55] file:text-xs file:font-medium hover:file:bg-[#E3E1DB]" />
                    <p className="text-[11px] text-[#9B9890]">CSV needs a <span className="font-medium">phone</span> column and a <span className="font-medium">name</span> column (first/last/business or “name”). Columns auto-detect.</p>
                    {csvError && <p className="text-[11px] text-[#D63B1F]">{csvError}</p>}
                    <button type="button" onClick={handleCsvImport} disabled={csvBusy || !csvFile}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
                      {csvBusy ? <><i className="fas fa-spinner fa-spin mr-1.5" />Importing…</> : 'Import & use this list'}
                    </button>
                  </div>
                )}

                {/* Engagement filters — narrow the list by chat history with the sender line */}
                {formData.contactListId && (
                  <div className="mt-5 p-4 border border-[#E3E1DB] rounded-lg">
                    <h5 className="text-sm font-semibold text-[#131210]">Who should get this?</h5>
                    <p className="text-xs text-[#9B9890] mt-0.5 mb-3.5">Narrow the audience using their chat history with the sender number.</p>
                    <div className="space-y-3">
                      <div>
                        <select
                          value={formData.filterEngagement}
                          onChange={(e) => setFormData(f => ({ ...f, filterEngagement: e.target.value }))}
                          className="w-full px-3 py-3 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                        >
                          <option value="all">Everyone in the list</option>
                          <option value="not_replied">Only people who never replied</option>
                          <option value="not_replied_recent">Only people quiet for the last…</option>
                          <option value="replied">Only people who replied before</option>
                          <option value="never_messaged">Only brand-new — never texted from this line</option>
                        </select>
                      </div>
                      {formData.filterEngagement === 'not_replied_recent' && (
                        <div>
                          <label className="block text-sm font-medium text-[#5C5A55] mb-2">Quiet for the last</label>
                          <select
                            value={String(formData.filterWindowHours)}
                            onChange={(e) => setFormData(f => ({ ...f, filterWindowHours: Number(e.target.value) }))}
                            className="w-full px-3 py-3 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                          >
                            <option value="24">24 hours</option>
                            <option value="48">48 hours</option>
                            <option value="72">3 days</option>
                            <option value="168">7 days</option>
                            <option value="336">14 days</option>
                            <option value="720">30 days</option>
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-[#5C5A55] mb-2">Skip anyone texted in the last…</label>
                        <select
                          value={String(formData.filterQuietHours)}
                          onChange={(e) => setFormData(f => ({ ...f, filterQuietHours: Number(e.target.value) }))}
                          className="w-full px-3 py-3 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                        >
                          <option value="0">Off</option>
                          <option value="12">12 hours</option>
                          <option value="24">24 hours</option>
                          <option value="48">48 hours</option>
                          <option value="168">7 days</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-[11px] text-[#9B9890] mt-3">Filters are re-checked at send time, and on every cycle for recurring campaigns.</p>
                  </div>
                )}
              </div>
            ) : formData.source === 'monday' ? (
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
                      <div className="py-2">
                        <div className="flex items-center justify-between text-xs text-[#9B9890] mb-1.5">
                          <span className="flex items-center gap-2"><i className="fas fa-spinner fa-spin text-[#D63B1F]" />Fetching items from Monday…</span>
                          <span className="font-medium text-[#5C5A55]">
                            {mondayFetch.total > 0
                              ? `${mondayFetch.fetched.toLocaleString()} / ${mondayFetch.total.toLocaleString()}`
                              : `${mondayFetch.fetched.toLocaleString()} fetched`}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-[#EFEDE8] rounded-full overflow-hidden">
                          <div className="h-full bg-[#D63B1F] transition-all duration-300 rounded-full"
                            style={{ width: mondayFetch.total > 0 ? `${Math.min(100, Math.round(mondayFetch.fetched / mondayFetch.total * 100))}%` : '40%', opacity: mondayFetch.total > 0 ? 1 : 0.5 }} />
                        </div>
                      </div>
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
                          onChange={(e) => { setMondayItemSearch(e.target.value); setMondayItemPage(0) }}
                          placeholder="Search items…"
                          className="w-full mb-2 px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                        />
                        {searchedPool.length === 0 ? (
                          <p className="text-xs text-[#9B9890]">No rows match.</p>
                        ) : (
                        <>
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
                            <span className="text-sm font-medium text-[#131210]">Select all{recipientPool.length > visibleMondayItems.length ? ` (${recipientPool.length.toLocaleString()} rows)` : ''}</span>
                          </label>
                          {visibleMondayItems.map(it => (
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
                        {mondayItemPageCount > 1 && (
                          <div className="flex items-center justify-between mt-2 text-xs text-[#9B9890]">
                            <span>
                              {(mondayItemPageClamped * MONDAY_ITEMS_PER_PAGE + 1).toLocaleString()}–{Math.min((mondayItemPageClamped + 1) * MONDAY_ITEMS_PER_PAGE, searchedPool.length).toLocaleString()} of {searchedPool.length.toLocaleString()}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button type="button" disabled={mondayItemPageClamped === 0} onClick={() => setMondayItemPage(p => Math.max(0, p - 1))}
                                className="px-2 py-1 border border-[#E3E1DB] rounded-md bg-white disabled:opacity-40 hover:bg-[#F7F6F3]">Prev</button>
                              <span>Page {mondayItemPageClamped + 1} / {mondayItemPageCount}</span>
                              <button type="button" disabled={mondayItemPageClamped + 1 >= mondayItemPageCount} onClick={() => setMondayItemPage(p => p + 1)}
                                className="px-2 py-1 border border-[#E3E1DB] rounded-md bg-white disabled:opacity-40 hover:bg-[#F7F6F3]">Next</button>
                            </div>
                          </div>
                        )}
                        </>
                        )}
                        {errors.mondayItemIds && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.mondayItemIds}</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Spreadsheet picker */}
                <div>
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Spreadsheet *</label>
                  <SearchableDropdown
                    value={formData.sheetSpreadsheetId}
                    onChange={(v) => {
                      const ss = sheetsSpreadsheets.find(s => String(s.id) === String(v))
                      setFormData(f => ({
                        ...f,
                        sheetSpreadsheetId: v,
                        sheetSpreadsheetName: ss?.name || '',
                        sheetTabId: null,
                        sheetTabName: '',
                        sheetPhoneColumn: '',
                        sheetRowIds: [],
                      }))
                    }}
                    options={sheetsSpreadsheets.map(s => ({ value: String(s.id), label: s.name, searchText: s.name }))}
                    placeholder={sheetsLoading.spreadsheets ? 'Loading spreadsheets…' : (sheetsSpreadsheets.length === 0 ? 'No spreadsheets found' : 'Select a spreadsheet')}
                    loading={sheetsLoading.spreadsheets}
                    error={errors.sheetSpreadsheetId}
                    renderSelected={(o) => o.label}
                    renderOption={(o) => (<p className="text-sm font-medium text-[#131210]">{o.label}</p>)}
                  />
                  {errors.sheetSpreadsheetId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.sheetSpreadsheetId}</p>}
                </div>

                {/* Tab picker */}
                {formData.sheetSpreadsheetId && (
                  <div>
                    <label className="block text-sm font-medium text-[#5C5A55] mb-2">Sheet Tab *</label>
                    {sheetsLoading.tabs ? (
                      <p className="text-xs text-[#9B9890] py-3">Loading tabs…</p>
                    ) : (
                      <select
                        value={formData.sheetTabId == null ? '' : String(formData.sheetTabId)}
                        onChange={(e) => {
                          const tab = sheetsTabs.find(t => String(t.id) === e.target.value)
                          setFormData(f => ({
                            ...f,
                            sheetTabId: tab ? tab.id : null,
                            sheetTabName: tab?.title || '',
                            sheetPhoneColumn: '',
                            sheetRowIds: [],
                          }))
                        }}
                        className={`w-full px-3 py-3 border rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F] ${errors.sheetTabName ? 'border-[#D63B1F]' : 'border-[#D4D1C9]'}`}
                      >
                        <option value="">{sheetsTabs.length === 0 ? 'No tabs found' : 'Select a tab…'}</option>
                        {sheetsTabs.map(t => (
                          <option key={t.id} value={String(t.id)}>{t.title}{t.rowCount ? ` (${t.rowCount.toLocaleString()} rows)` : ''}</option>
                        ))}
                      </select>
                    )}
                    {errors.sheetTabName && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.sheetTabName}</p>}
                  </div>
                )}
              </div>

              {/* Phone column picker */}
              {formData.sheetSpreadsheetId && formData.sheetTabName && (
                <div>
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">Phone Number Column *</label>
                  <SearchableDropdown
                    value={formData.sheetPhoneColumn}
                    onChange={(v) => setFormData(f => ({ ...f, sheetPhoneColumn: v }))}
                    options={sheetsColumns.map(c => ({
                      value: c.id,
                      label: c.title,
                      letter: c.id,
                      searchText: `${c.title} ${c.id}`,
                    }))}
                    placeholder={sheetsLoading.columns ? 'Loading columns…' : 'Select the phone column'}
                    loading={sheetsLoading.columns}
                    error={errors.sheetPhoneColumn}
                    renderSelected={(o) => o.label}
                    renderOption={(o) => (
                      <div>
                        <p className="text-sm font-medium text-[#131210]">{o.label}</p>
                        <p className="text-xs text-[#9B9890] mt-0.5 font-mono">Column {o.letter}</p>
                      </div>
                    )}
                  />
                  {errors.sheetPhoneColumn && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.sheetPhoneColumn}</p>}
                  <p className="text-[11px] text-[#9B9890] mt-1.5">Rows missing a phone in this column will be skipped at send time.</p>
                </div>
              )}

              {/* Recipient (row) picker — choose which sheet rows to send to */}
              {formData.sheetSpreadsheetId && formData.sheetTabName && formData.sheetPhoneColumn && (
                <div>
                  <label className="block text-sm font-medium text-[#5C5A55] mb-2">
                    Recipients
                    {sheetsRows.length > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-[#9B9890]">
                        {formData.sheetRowIds.length} of {sheetsRows.length} selected
                      </span>
                    )}
                  </label>
                  {sheetsLoading.rows ? (
                    <p className="text-xs text-[#9B9890] py-2 flex items-center gap-2">
                      <i className="fas fa-spinner fa-spin text-[#D63B1F]" />Fetching rows from Google Sheets…
                    </p>
                  ) : sheetsRows.length === 0 ? (
                    <p className="text-xs text-[#9B9890]">No rows in this sheet.</p>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={sheetsRowSearch}
                        onChange={(e) => { setSheetsRowSearch(e.target.value); setSheetsRowPage(0) }}
                        placeholder="Search rows…"
                        className="w-full mb-2 px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                      />
                      {searchedSheetRows.length === 0 ? (
                        <p className="text-xs text-[#9B9890]">No rows match.</p>
                      ) : (
                      <>
                      <div className="border border-[#E3E1DB] rounded-lg max-h-60 overflow-y-auto divide-y divide-[#F0EEE9]">
                        <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3] sticky top-0 bg-[#FFFFFF] border-b border-[#E3E1DB]">
                          <input
                            type="checkbox"
                            checked={sheetsRows.length > 0 && formData.sheetRowIds.length === sheetsRows.length}
                            ref={el => { if (el) el.indeterminate = formData.sheetRowIds.length > 0 && formData.sheetRowIds.length < sheetsRows.length }}
                            onChange={(e) => {
                              setFormData(f => ({ ...f, sheetRowIds: e.target.checked ? sheetsRows.map(r => r.id) : [] }))
                            }}
                            className="accent-[#D63B1F]"
                          />
                          <span className="text-sm font-medium text-[#131210]">Select all{sheetsRows.length > visibleSheetRows.length ? ` (${sheetsRows.length.toLocaleString()} rows)` : ''}</span>
                        </label>
                        {visibleSheetRows.map(r => (
                            <label key={r.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3]">
                              <input
                                type="checkbox"
                                checked={formData.sheetRowIds.includes(r.id)}
                                onChange={(e) => {
                                  setFormData(f => {
                                    const next = e.target.checked
                                      ? [...f.sheetRowIds, r.id]
                                      : f.sheetRowIds.filter(x => x !== r.id)
                                    return { ...f, sheetRowIds: next }
                                  })
                                }}
                                className="accent-[#D63B1F] shrink-0"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm text-[#131210] truncate">{r.name || `Row ${r.id}`}</span>
                                <span className={`block text-xs truncate ${r.phone ? 'text-[#9B9890] font-mono' : 'text-[#9B9890]'}`}>{r.phone || '—'}</span>
                              </span>
                            </label>
                          ))}
                      </div>
                      {sheetsRowPageCount > 1 && (
                        <div className="flex items-center justify-between mt-2 text-xs text-[#9B9890]">
                          <span>
                            {(sheetsRowPageClamped * SHEET_ROWS_PER_PAGE + 1).toLocaleString()}–{Math.min((sheetsRowPageClamped + 1) * SHEET_ROWS_PER_PAGE, searchedSheetRows.length).toLocaleString()} of {searchedSheetRows.length.toLocaleString()}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button type="button" disabled={sheetsRowPageClamped === 0} onClick={() => setSheetsRowPage(p => Math.max(0, p - 1))}
                              className="px-2 py-1 border border-[#E3E1DB] rounded-md bg-white disabled:opacity-40 hover:bg-[#F7F6F3]">Prev</button>
                            <span>Page {sheetsRowPageClamped + 1} / {sheetsRowPageCount}</span>
                            <button type="button" disabled={sheetsRowPageClamped + 1 >= sheetsRowPageCount} onClick={() => setSheetsRowPage(p => p + 1)}
                              className="px-2 py-1 border border-[#E3E1DB] rounded-md bg-white disabled:opacity-40 hover:bg-[#F7F6F3]">Next</button>
                          </div>
                        </div>
                      )}
                      </>
                      )}
                      {errors.sheetRowIds && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.sheetRowIds}</p>}
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
                  ) : formData.source === 'sheets' ? (
                    sheetsColumns.filter(c => c.placeholder).length === 0 ? (
                      <span className="text-xs text-[#9B9890] italic">Pick a spreadsheet to see available columns</span>
                    ) : (
                      sheetsColumns
                        .filter(c => c.placeholder)
                        .filter((c, i, arr) => arr.findIndex(x => x.placeholder === c.placeholder) === i)
                        .map(c => {
                          const tag = `{{${c.placeholder}}}`
                          return (
                            <button key={c.id} type="button" onClick={() => insertPlaceholder(tag)} title={`${c.title} (column ${c.id})`} className="px-2.5 py-1 text-xs bg-[#EFEDE8] hover:bg-[#fdecea] hover:text-[#D63B1F] hover:border-[#D63B1F] text-[#5C5A55] rounded-md border border-[#E3E1DB] font-mono transition-colors">{tag}</button>
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
                  : formData.source === 'sheets'
                  ? `Google Sheet — ${formData.sheetSpreadsheetName || 'spreadsheet'}`
                  : (list?.label || '—')
                const recipientCount = formData.source === 'monday'
                  ? formData.mondayItemIds.length
                  : formData.source === 'sheets'
                  ? formData.sheetRowIds.length
                  // Contacts: once the preview has loaded, count only who passes
                  // the engagement filters; fall back to the raw list size while
                  // it loads (or if it errors).
                  : (typeof recipPreview?.matched === 'number' ? recipPreview.matched : (list?.count ?? 0))
                const rows = [
                  ['Campaign', formData.name || '—'],
                  ['Audience', audienceLabel],
                  ['Recipients', String(recipientCount)],
                  ['Sends from', pn ? (pn.name ? `${pn.name} — ${pn.number}` : pn.number) : '—'],
                ]
                // Resolved recipient list (Monday/Sheets path — the picked rows).
                const previewItems = formData.source === 'monday'
                  ? mondayItems.filter(it => formData.mondayItemIds.includes(it.id))
                  : formData.source === 'sheets'
                  ? sheetsRows.filter(r => formData.sheetRowIds.includes(r.id))
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

                  {/* Recipients review (contacts source) — who matches the engagement filters right now */}
                  {formData.source === 'contacts' && (
                    <div className="mb-4">
                      {recipPreviewLoading ? (
                        <p className="text-xs text-[#9B9890]"><i className="fas fa-spinner fa-spin mr-1.5" />Checking who matches your filters…</p>
                      ) : recipPreviewError ? (
                        <p className="text-xs text-[#D63B1F]">{recipPreviewError}</p>
                      ) : recipPreview ? (
                        recipPreview.matched === 0 ? (
                          <p className="text-xs text-[#D63B1F]">No one matches these filters — nothing would be sent.</p>
                        ) : (() => {
                          const q = recipSearch.trim().toLowerCase()
                          const shown = q
                            ? (recipPreview.recipients || []).filter(r => `${r.name || ''} ${r.phone || ''}`.toLowerCase().includes(q))
                            : (recipPreview.recipients || [])
                          return (
                            <>
                              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1.5">
                                {recipPreview.matched.toLocaleString()} of {recipPreview.total.toLocaleString()} people will receive this
                                {recipPreview.excluded > 0 && <> · {recipPreview.excluded.toLocaleString()} filtered out</>}
                              </p>
                              <input type="text" value={recipSearch} onChange={(e) => setRecipSearch(e.target.value)} placeholder="Search by name or phone…"
                                className="w-full px-3 py-2 mb-2 border border-[#D4D1C9] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20" />
                              <div className="border border-[#E3E1DB] rounded-lg max-h-[300px] overflow-y-auto divide-y divide-[#F0EEE9]">
                                {shown.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-[#9B9890]">No matches for “{recipSearch}”.</p>
                                ) : shown.map((r, i) => (
                                  <div key={`${r.phone}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                                    <div className="min-w-0">
                                      <p className="text-sm text-[#131210] truncate">{r.name || r.phone}</p>
                                      {(r.last_outbound_at || r.last_inbound_at) && (
                                        <p className="text-[11px] text-[#9B9890] mt-0.5">
                                          {r.last_outbound_at && <>Last texted {timeAgo(r.last_outbound_at)}</>}
                                          {r.last_outbound_at && r.last_inbound_at && ' · '}
                                          {r.last_inbound_at && <>Replied {timeAgo(r.last_inbound_at)}</>}
                                        </p>
                                      )}
                                    </div>
                                    <span className="text-xs font-mono shrink-0 text-[#9B9890]">{r.phone}</span>
                                  </div>
                                ))}
                                {recipPreview.truncated && (
                                  <div className="px-3 py-2 text-xs text-[#9B9890] text-center">
                                    Showing first 1,000 — all {recipPreview.matched.toLocaleString()} will be sent.
                                  </div>
                                )}
                              </div>
                            </>
                          )
                        })()
                      ) : null}
                    </div>
                  )}

                  {(formData.source === 'monday' || formData.source === 'sheets') && (
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

              {/* ── Sending pace & limits ─────────────────────────────── */}
              <label className="block text-sm font-medium text-[#5C5A55] mt-5 mb-2">Sending pace &amp; limits</label>
              <div className="space-y-2.5">
                {/* Daily cap */}
                <div className="p-3 border border-[#E3E1DB] rounded-lg">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={formData.dailyLimitEnabled} onChange={(e) => setFormData({ ...formData, dailyLimitEnabled: e.target.checked })} className="accent-[#D63B1F]" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#131210]">Limit per day</p>
                      <p className="text-xs text-[#9B9890]">Spread the campaign — send only this many each day, the rest queue for the next day.</p>
                    </div>
                  </label>
                  {formData.dailyLimitEnabled && (
                    <div className="flex items-center gap-2 mt-2.5 pl-7">
                      <input type="number" min={1} value={formData.dailyCap} onChange={(e) => setFormData({ ...formData, dailyCap: e.target.value })} className="w-28 px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20" />
                      <span className="text-sm text-[#5C5A55]">messages / day</span>
                    </div>
                  )}
                </div>
                {/* Business hours */}
                <label className="flex items-center gap-3 p-3 border border-[#E3E1DB] rounded-lg cursor-pointer hover:bg-[#F7F6F3]">
                  <input type="checkbox" checked={formData.businessHoursOnly} onChange={(e) => setFormData({ ...formData, businessHoursOnly: e.target.checked })} className="accent-[#D63B1F]" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#131210]">Only during business hours</p>
                    <p className="text-xs text-[#9B9890]">
                      {bizHours ? `${(bizHours.start || '09:00').slice(0,5)}–${(bizHours.end || '18:00').slice(0,5)} ${bizHours.tz || ''}, your business days. ` : ''}
                      Otherwise sends any time. <a href="/settings?section=business-hours" className="text-[#D63B1F] hover:underline">Edit hours</a>
                    </p>
                  </div>
                </label>
                {/* Recurring */}
                <label className={`flex items-center gap-3 p-3 border border-[#E3E1DB] rounded-lg ${formData.dailyLimitEnabled ? 'cursor-pointer hover:bg-[#F7F6F3]' : 'opacity-50'}`}>
                  <input type="checkbox" disabled={!formData.dailyLimitEnabled} checked={formData.recurring} onChange={(e) => setFormData({ ...formData, recurring: e.target.checked })} className="accent-[#D63B1F]" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#131210]">Recurring (keep cycling)</p>
                    <p className="text-xs text-[#9B9890]">When the list finishes, re-pull the source and start over — a continuous drip. Requires a daily limit.</p>
                  </div>
                </label>
              </div>
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
          <div className="flex items-center gap-2">
            {/* Save as draft — finish & launch later. Needs only a name. */}
            <button type="button" onClick={handleSaveDraft} disabled={isSubmitting || !formData.name.trim()}
              className="px-4 py-2.5 text-sm font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] disabled:opacity-40 transition-colors">
              Save as draft
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

  // Per-recipient list with expected (ETA) or actual send times.
  const [recipTab, setRecipTab] = useState('queued')   // queued | sent | failed
  const [recipients, setRecipients] = useState([])
  const [recipPage, setRecipPage] = useState(0)
  const [recipTotal, setRecipTotal] = useState(0)
  const [loadingRecip, setLoadingRecip] = useState(false)
  const [liveStats, setLiveStats] = useState(null)   // live sent/failed/total/status, polled every 5s
  useEffect(() => { setRecipPage(0) }, [recipTab])
  useEffect(() => {
    let alive = true
    const load = async (showLoading) => {
      if (showLoading) setLoadingRecip(true)
      try {
        const res = await apiGet(`/api/campaigns/${campaign.id}/recipients?status=${recipTab}&page=${recipPage}`)
        const data = await res.json()
        if (alive) { setRecipients(data.recipients || []); setRecipTotal(data.total || 0); setLiveStats(data.campaign || null) }
      } catch { if (alive) setRecipients([]) } finally { if (alive && showLoading) setLoadingRecip(false) }
    }
    load(true)
    const iv = setInterval(() => load(false), 5000)   // live progress + ETA refresh
    return () => { alive = false; clearInterval(iv) }
  }, [campaign.id, recipTab, recipPage])
  const fmtEta = (iso) => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: campaign.send_timezone || undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) }
    catch { return iso }
  }

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
                    : campaign.source === 'sheets'
                    ? { label: 'Google Sheet', value: campaign.sheet_name || 'Google Sheet' }
                    : { label: 'Contact List', value: campaign.contact_list_names?.join(', ') || 'Unknown' },
                  { label: 'Sender Number', value: campaign.sender_number || 'Unknown' },
                  { label: 'Recipients', value: campaign.total_recipients ?? 0 },
                  { label: 'Created', value: formatDate(campaign.created_at) },
                ].map((item) => (
                  <div key={item.label}><p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">{item.label}</p><p className="text-sm text-[#5C5A55]">{item.value}</p></div>
                ))}
              </div>
              <div><p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Status</p><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>{statusLabel}</span></div>

              {/* Live progress bar (polls every 5s) */}
              {(() => {
                const s = liveStats || campaign
                const total = s.total_recipients || campaign.total_recipients || 0
                const done = (s.sent_count || 0) + (s.failed_count || 0)
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
                return (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-[#9B9890] uppercase tracking-wider">Progress{s.recurring ? ` · cycle ${s.cycle}` : ''}</p>
                      <p className="text-xs text-[#5C5A55]">{(s.sent_count || 0).toLocaleString()} sent{s.failed_count ? ` · ${s.failed_count} failed` : ''} / {total.toLocaleString()} · {pct}%</p>
                    </div>
                    <div className="h-2 rounded-full bg-[#EFEDE8] overflow-hidden">
                      <div className="h-full bg-[#D63B1F] transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })()}
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

            {/* Recipients & schedule — expected delivery time per recipient */}
            <div className="border-t border-[#E3E1DB] px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider">Recipients &amp; schedule</p>
                <div className="flex gap-1">
                  {[['queued', 'Upcoming'], ['sent', 'Sent'], ['failed', 'Failed']].map(([k, l]) => (
                    <button key={k} onClick={() => setRecipTab(k)} className={`px-2.5 py-1 text-xs rounded-md ${recipTab === k ? 'bg-[#D63B1F] text-white' : 'text-[#5C5A55] hover:bg-[#F7F6F3]'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {loadingRecip ? (
                <p className="text-sm text-[#9B9890]">Loading…</p>
              ) : recipients.length === 0 ? (
                <p className="text-sm text-[#9B9890]">{recipTab === 'queued' ? 'Nothing queued.' : recipTab === 'sent' ? 'Nothing sent yet.' : 'No failures.'}</p>
              ) : (
                <>
                  <div className="border border-[#E3E1DB] rounded-lg divide-y divide-[#EFEDE8] max-h-72 overflow-y-auto">
                    {recipients.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[#131210] font-mono">{r.to_number}</p>
                          <p className="text-xs text-[#9B9890] truncate">{r.body}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {recipTab === 'queued' ? (
                            <><p className="text-[10px] text-[#9B9890] uppercase tracking-wide">~ Expected</p><p className="text-xs text-[#5C5A55]">{r.eta ? fmtEta(r.eta) : '—'}</p></>
                          ) : recipTab === 'sent' ? (
                            <><p className="text-[10px] text-[#9B9890] uppercase tracking-wide">Sent</p><p className="text-xs text-[#5C5A55]">{r.sent_at ? fmtEta(r.sent_at) : '—'}</p></>
                          ) : (
                            <p className="text-xs text-[#D63B1F] max-w-[150px] truncate" title={r.error_message}>{r.error_message || 'Failed'}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {recipTotal > 100 && (
                    <div className="flex items-center justify-between mt-2 text-xs text-[#9B9890]">
                      <span>{recipPage * 100 + 1}–{Math.min((recipPage + 1) * 100, recipTotal)} of {recipTotal}</span>
                      <div className="flex gap-1">
                        <button disabled={recipPage === 0} onClick={() => setRecipPage(p => Math.max(0, p - 1))} className="px-2 py-1 border border-[#E3E1DB] rounded disabled:opacity-40">Prev</button>
                        <button disabled={(recipPage + 1) * 100 >= recipTotal} onClick={() => setRecipPage(p => p + 1)} className="px-2 py-1 border border-[#E3E1DB] rounded disabled:opacity-40">Next</button>
                      </div>
                    </div>
                  )}
                  {recipTab === 'queued' && <p className="text-[11px] text-[#9B9890] mt-2">Estimates from the campaign's pace, daily limit, and send window — actual times shift if you pause or change limits.</p>}
                </>
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

function CreateRVMCampaignModal({ contactLists, phoneNumbers, subscription, creditBalance = 0, onClose, onCreated, editCampaign = null }) {
  // Step 1 (Basics): name, sender, audio
  // Step 2 (Audience): contact lists + phone columns
  // Step 3 (Chunks & Preview): chunk size + chunk picker + recipient sample
  // When editing a draft, every field below is seeded from the saved row.
  const isEdit = !!editCampaign
  const _init = useMemo(() => deriveRvmWizardInit(editCampaign), [editCampaign])
  const [step, setStep] = useState(1)
  const [name, setName] = useState(() => _init.name)
  const [senderNumber, setSenderNumber] = useState(() => _init.senderNumber)
  const [uploadState, setUploadState] = useState(() => _init.uploadState) // null | 'uploading' | { url, voicedropUrl, path, name }
  // Audio Library — reusable saved recordings for this workspace.
  const [library, setLibrary] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [selectedListIds, setSelectedListIds] = useState(() => _init.selectedListIds)
  const [selectedColumns, setSelectedColumns] = useState(() => _init.selectedColumns)
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
  const [throttleMode, setThrottleMode] = useState(() => _init.throttleMode)
  const [presetId, setPresetId] = useState(() => _init.presetId)
  const [throttleCount, setThrottleCount] = useState(() => _init.throttleCount)         // manual mode
  const [throttleWindowValue, setThrottleWindowValue] = useState(() => _init.throttleWindowValue)
  const [throttleUnit, setThrottleUnit] = useState(() => _init.throttleUnit)
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
  const [whenMode, setWhenMode] = useState(() => _init.whenMode)
  const [startAtLocal, setStartAtLocal] = useState(() => _init.startAtLocal)   // "YYYY-MM-DDTHH:MM"
  const [sendTimezone, setSendTimezone] = useState(() => _init.sendTimezone)

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
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(() => _init.dailyLimitEnabled)
  const [dailyLimit, setDailyLimit] = useState(() => _init.dailyLimit)
  const resolvedDailyCap = dailyLimitEnabled && dailyLimit > 0 ? Math.floor(dailyLimit) : null
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [created, setCreated] = useState(false)
  const [savedAsDraft, setSavedAsDraft] = useState(false)
  const fileInputRef = useRef(null)

  // Preview data (fetched lazily when Step 2 / Step 3 are visible)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [detectedColumns, setDetectedColumns] = useState([])  // [{key,label,count,isPrimary}]
  const [totalRecipients, setTotalRecipients] = useState(0)
  // Contact statuses to skip (call-outcome filter). Pre-checks the "don't
  // contact" set; the user can adjust on the Audience step.
  const [excludeStatuses, setExcludeStatuses] = useState(() => _init.excludeStatuses)
  const [excludedByStatus, setExcludedByStatus] = useState(0)
  const toggleExcludeStatus = (id) =>
    setExcludeStatuses(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])

  // Monitor / canary numbers — get the voicemail once per day so you can confirm
  // the drip fired. Raw textarea (one per line / comma); parsed for the payload.
  const [monitorInput, setMonitorInput] = useState(() => _init.monitorInput)
  const monitorNumbers = monitorInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
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
  const [scanProgress, setScanProgress] = useState(null)   // { done, total } while batching
  const [scanError, setScanError] = useState('')
  const [landlinesRemoved, setLandlinesRemoved] = useState(false)
  const [purgeState, setPurgeState] = useState(null)   // null | 'purging' | 'done'

  // ── "Save selection as a reusable list" (post-scrub) ──────────────────────
  // Lets the user bank the kept recipients — optionally only certain carrier
  // types — as a new contact list. The copies carry their cached line_type, so
  // the saved list is already scrubbed and never re-charges on a future scan.
  const [saveListOpen, setSaveListOpen] = useState(false)
  const [saveListName, setSaveListName] = useState('')
  const [saveTypes, setSaveTypes] = useState(() => new Set(['mobile', 'voip', 'unknown']))
  const [savingList, setSavingList] = useState(false)   // false | true
  const [savedList, setSavedList] = useState(null)      // { name, inserted } | null
  const [saveListError, setSaveListError] = useState('')
  // Lists created from inside this modal — surfaced in the step-2 picker so the
  // user can immediately reuse what they just saved without a page reload.
  const [savedLists, setSavedLists] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 100   // render 100 rows/page so 28k+ lists stay snappy

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

  // ── Audio Library (reuse previously uploaded/recorded audio) ────────────
  const fetchLibrary = useCallback(async () => {
    setLibraryLoading(true)
    try {
      const res = await apiGet('/api/voicemail-recordings')
      const data = await res.json()
      if (res.ok && data.success) setLibrary(data.recordings || [])
    } catch { /* non-fatal — library just stays empty */ }
    finally { setLibraryLoading(false) }
  }, [])

  // Load the library once when the modal mounts so "Choose from library" is ready.
  useEffect(() => { fetchLibrary() }, [fetchLibrary])

  // Pick a saved recording — reuse it directly, NO re-upload.
  const useLibraryRecording = (rec) => {
    setUploadState({ url: rec.url, voicedropUrl: rec.voicedrop_url, path: rec.path, name: rec.name })
    setErrors(prev => ({ ...prev, audio: null }))
    setShowLibrary(false)
  }

  const deleteLibraryRecording = async (id) => {
    setLibrary(prev => prev.filter(r => r.id !== id))   // optimistic
    try { await apiDelete(`/api/voicemail-recordings/${id}`) }
    catch { fetchLibrary() }   // restore truth on failure
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
      fetchLibrary()   // the upload was auto-saved to the library — refresh so it appears
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
  // Memoized — a 28k filter must NOT re-run on every keystroke/render.
  const selectedRecipients = useMemo(
    () => chunkRecipients.filter(r => !excludedPhones.has(r.phone)),
    [chunkRecipients, excludedPhones]
  )
  const uniqueSelectedCount = useMemo(
    () => new Set(selectedRecipients.map(r => r.phone)).size,
    [selectedRecipients]
  )
  // Projected first/last send — simulating 28k+ sends is expensive, so memoize
  // it on a STABLE string key (resolvedSendDays/Windows are fresh arrays each
  // render and would defeat a normal dep array).
  const projStartMs = resolvedStartsAt ? Math.max(Date.now(), new Date(resolvedStartsAt).getTime()) : Date.now()
  const projSchedKey = [
    selectedRecipients.length, resolvedThrottleCount, resolvedThrottleWindowSeconds,
    resolvedDailyCap, resolvedTimezone, (resolvedSendDays || []).join(','),
    (resolvedSendWindows || []).map(w => `${w.start}-${w.end}`).join(','), resolvedStartsAt || '',
  ].join('|')
  const { projFirstMs, projLastMs } = useMemo(() => {
    const n = selectedRecipients.length
    if (n === 0) return { projFirstMs: projStartMs, projLastMs: projStartMs }
    const sched = estimateSendSchedule(n, projStartMs, resolvedThrottleCount, resolvedThrottleWindowSeconds, resolvedSendWindows, resolvedTimezone, resolvedDailyCap || 0, resolvedSendDays)
    return {
      projFirstMs: sched.length ? new Date(sched[0]).getTime() : projStartMs,
      projLastMs: sched.length ? new Date(sched[sched.length - 1]).getTime() : projStartMs,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projSchedKey])
  // Search results + selected-in-filter count — memoized so a 28k scan doesn't
  // run on every unrelated render.
  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return chunkRecipients
    return chunkRecipients.filter(r => (r.name || '').toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q))
  }, [chunkRecipients, searchQuery])
  const filteredSelectedCount = useMemo(
    () => searchFiltered.reduce((n, r) => n + (excludedPhones.has(r.phone) ? 0 : 1), 0),
    [searchFiltered, excludedPhones]
  )

  // ── Landline scrub ────────────────────────────────────────────────────────
  const scanLandlines = async () => {
    const phones = [...new Set(selectedRecipients.map(r => r.phone))]
    if (phones.length === 0) return
    setScanError(''); setScan('scanning'); setLandlinesRemoved(false); setPurgeState(null)
    setScanProgress({ done: 0, total: phones.length })

    // Scan the WHOLE list: split into batches and run a few in parallel with
    // retry, so a slow/failed batch can't stall the run and progress is real.
    const BATCH = 500
    const CONCURRENCY = 3
    const batches = []
    for (let i = 0; i < phones.length; i += BATCH) batches.push(phones.slice(i, i + BATCH))
    const agg = { breakdown: { mobile: 0, voip: 0, landline: 0, unknown: 0, total: 0 }, byPhone: {}, newLookups: 0, cached: 0, creditsCharged: 0, balance: 0 }
    let done = 0

    const runBatch = async (chunk) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await apiPost('/api/voicemail-campaigns/landline-scan', { phones: chunk })
          const data = await res.json()
          if (data.success) return data
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500 * attempt))
      }
      return null   // failed after retries
    }

    let idx = 0
    const worker = async () => {
      while (idx < batches.length) {
        const chunk = batches[idx++]
        const data = await runBatch(chunk)
        if (data) {
          for (const k of ['mobile', 'voip', 'landline', 'unknown', 'total']) agg.breakdown[k] += (data.breakdown[k] || 0)
          Object.assign(agg.byPhone, data.byPhone)
          agg.newLookups += data.newLookups || 0
          agg.cached += data.cached || 0
          agg.creditsCharged += data.creditsCharged || 0
          agg.balance = data.balance
        } else {
          // Batch failed after retries — don't abort the whole scan; mark unknown.
          for (const p of chunk) agg.byPhone[p] = 'unknown'
          agg.breakdown.unknown += chunk.length
          agg.breakdown.total += chunk.length
        }
        done += chunk.length
        setScanProgress({ done: Math.min(done, phones.length), total: phones.length })
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))
      setScan({ success: true, ...agg })
    } catch { setScanError('Scan failed — please try again.'); setScan(null) }
    finally { setScanProgress(null) }
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

  // Carrier-type counts across the CURRENTLY selected (kept) recipients — drives
  // the "save as list" filter. Falls back to "unknown" for un-scanned numbers.
  const saveTypeCounts = useMemo(() => {
    const c = { mobile: 0, voip: 0, landline: 0, unknown: 0 }
    const seen = new Set()
    for (const r of selectedRecipients) {
      if (seen.has(r.phone)) continue
      seen.add(r.phone)
      const lt = (scan && scan.byPhone && scan.byPhone[r.phone]) || 'unknown'
      c[lt] = (c[lt] || 0) + 1
    }
    return c
  }, [selectedRecipients, scan])

  // How many of the kept recipients would actually be saved given the type filter.
  const saveCandidateCount = useMemo(() => {
    if (!scan || !scan.byPhone) return new Set(selectedRecipients.map(r => r.phone)).size
    const seen = new Set()
    for (const r of selectedRecipients) {
      if (seen.has(r.phone)) continue
      const lt = scan.byPhone[r.phone] || 'unknown'
      if (saveTypes.has(lt)) seen.add(r.phone)
    }
    return seen.size
  }, [selectedRecipients, scan, saveTypes])

  const toggleSaveType = (t) => setSaveTypes(prev => {
    const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n
  })

  // Lists shown in the step-2 picker: ones saved from inside this modal first,
  // then the workspace's existing lists.
  const pickableLists = useMemo(() => [...savedLists, ...contactLists], [savedLists, contactLists])

  const handleSaveAsList = async () => {
    const listName = saveListName.trim()
    if (!listName) { setSaveListError('Name the list first.'); return }

    // Final kept set, de-duped by phone and filtered by the chosen carrier types.
    const seen = new Set()
    const contactIds = []
    for (const r of selectedRecipients) {
      if (!r.contactId || seen.has(r.phone)) continue
      if (scan && scan.byPhone) {
        const lt = scan.byPhone[r.phone] || 'unknown'
        if (!saveTypes.has(lt)) continue
      }
      seen.add(r.phone)
      contactIds.push(r.contactId)
    }
    if (contactIds.length === 0) { setSaveListError('No contacts match the selected types.'); return }

    setSavingList(true); setSaveListError(''); setSavedList(null)
    try {
      const res = await apiPost('/api/contact-lists/from-recipients', {
        name: listName,
        contactIds,
        lineTypeByPhone: scan && scan.byPhone ? scan.byPhone : undefined,
        includeLineTypes: scan && scan.byPhone ? [...saveTypes] : undefined,
      })
      const data = await res.json()
      if (!res.ok || !data.success) { setSaveListError(data.error || 'Failed to save list.'); return }
      setSavedList({ name: data.list.name, inserted: data.inserted })
      setSavedLists(prev => [{ id: data.list.id, name: data.list.name, contact_count: data.inserted }, ...prev])
      setSaveListName('')
    } catch {
      setSaveListError('Failed to save list. Please try again.')
    } finally {
      setSavingList(false)
    }
  }

  // The full campaign payload — shared by Launch and Save-as-draft. The backend
  // always creates the row as `status: 'draft'`; the difference is whether we
  // then call /start.
  const buildCampaignPayload = () => ({
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
    monitorNumbers,
    startsAt: resolvedStartsAt,
    explicitRecipients: selectedRecipients.map(r => ({
      phone: r.phone,
      contactId: r.contactId,
      sourceColumn: r.sourceColumn,
    })),
  })

  const handleLaunch = async () => {
    if (!validateStep(3)) return
    if (selectedRecipients.length === 0) {
      setErrors({ recipients: 'At least one recipient must be selected' })
      return
    }
    setIsSubmitting(true)
    setErrors({})
    try {
      // Editing a draft → update it in place; otherwise create a new campaign.
      const response = isEdit
        ? await apiPut(`/api/voicemail-campaigns/${editCampaign.id}`, buildCampaignPayload())
        : await apiPost('/api/voicemail-campaigns', buildCampaignPayload())
      const data = await response.json()
      if (!data.success) { setErrors({ submit: data.error || 'Failed to save campaign' }); return }
      const launchId = isEdit ? editCampaign.id : data.campaign.id
      // Auto-launch (matches legacy behavior).
      const startRes = await apiPost(`/api/voicemail-campaigns/${launchId}/start`, {})
      const startData = await startRes.json()
      if (!startRes.ok || !startData.success) {
        setErrors({ submit: startData.message || startData.error || 'Saved as draft — could not start. Open it and press Launch to retry.' })
        return
      }
      setCreated(true)
    } catch {
      setErrors({ submit: 'Failed to launch campaign. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Everything a draft needs to be launchable later (the View modal's "Launch"
  // re-sends the already-queued recipients — there's no re-edit step, so we
  // require a complete, ready-to-send config before allowing a draft save).
  const canSaveDraft = (
    !!name.trim() && !!senderNumber &&
    !!uploadState && uploadState !== 'uploading' &&
    selectedListIds.length > 0 && selectedColumns.length > 0 &&
    selectedRecipients.length > 0
  )
  const handleSaveDraft = async () => {
    if (!canSaveDraft) return
    setIsSavingDraft(true)
    setErrors({})
    try {
      // Same payload as Launch, but we DON'T call /start — the row stays a draft.
      // Editing an existing draft updates it in place.
      const response = isEdit
        ? await apiPut(`/api/voicemail-campaigns/${editCampaign.id}`, buildCampaignPayload())
        : await apiPost('/api/voicemail-campaigns', buildCampaignPayload())
      const data = await response.json()
      if (!data.success) { setErrors({ submit: data.error || 'Failed to save draft' }); return }
      setSavedAsDraft(true)
      setCreated(true)
    } catch {
      setErrors({ submit: 'Failed to save draft. Please try again.' })
    } finally {
      setIsSavingDraft(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
          <div className="px-5 py-8 text-center">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3"><i className={`fas ${savedAsDraft ? 'fa-bookmark text-[#5C5A55]' : 'fa-check text-green-600'}`}></i></div>
            <h3 className="text-sm font-semibold text-[#131210] mb-1">{savedAsDraft ? (isEdit ? 'Draft updated' : 'Saved as draft') : 'Voicemail campaign launched'}</h3>
            <p className="text-xs text-[#9B9890] mb-4">
              {savedAsDraft
                ? `${selectedRecipients.length.toLocaleString()} ${selectedRecipients.length === 1 ? 'recipient is' : 'recipients are'} queued and ready. Nothing has been sent yet — open the campaign and press Launch whenever you're ready.`
                : `Dispatching to ${selectedRecipients.length.toLocaleString()} ${selectedRecipients.length === 1 ? 'recipient' : 'recipients'} via the queue. You can close this tab — open the campaign to watch progress.`}
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
          <h3 className="text-base sm:text-lg font-semibold text-[#131210]">{isEdit ? 'Edit voicemail campaign' : 'New voicemail campaign'}</h3>
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

                {/* Idle: upload, record, OR reuse from the library */}
                {!uploadState && !recording && (
                  <>
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
                    {/* Reuse a saved recording — no re-upload needed */}
                    <button
                      type="button"
                      onClick={() => { setShowLibrary(v => !v); if (!library.length) fetchLibrary() }}
                      className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-[#E3E1DB] rounded-lg text-sm text-[#5C5A55] hover:bg-[#F7F6F3]"
                    >
                      <i className="fas fa-folder-open text-[#D63B1F]" />
                      Choose from library
                      {library.length > 0 && <span className="text-[11px] text-[#9B9890]">({library.length})</span>}
                      <i className={`fas fa-chevron-${showLibrary ? 'up' : 'down'} text-[10px] text-[#9B9890]`} />
                    </button>

                    {showLibrary && (
                      <div className="mt-2 border border-[#E3E1DB] rounded-lg overflow-hidden">
                        {libraryLoading && (
                          <p className="px-4 py-4 text-xs text-[#9B9890] text-center"><i className="fas fa-spinner fa-spin mr-1.5" />Loading saved recordings…</p>
                        )}
                        {!libraryLoading && library.length === 0 && (
                          <p className="px-4 py-5 text-xs text-[#9B9890] text-center">No saved recordings yet. Audio you upload or record is saved here automatically for reuse.</p>
                        )}
                        {!libraryLoading && library.length > 0 && (
                          <div className="max-h-64 overflow-y-auto divide-y divide-[#F0EEE9]">
                            {library.map(rec => (
                              <div key={rec.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#F7F6F3]">
                                <i className="fas fa-music text-[#D63B1F] flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-[#131210] truncate" title={rec.name}>{rec.name}</p>
                                  {rec.url && <audio controls src={rec.url} className="w-full mt-1" style={{ height: 30 }} />}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => useLibraryRecording(rec)}
                                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded-md hover:bg-[#c4351b]"
                                >
                                  Use
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteLibraryRecording(rec.id)}
                                  title="Remove from library"
                                  className="flex-shrink-0 px-2 py-1.5 text-xs text-[#9B9890] hover:text-[#D63B1F]"
                                >
                                  <i className="fas fa-trash-alt" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
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
                {pickableLists.length === 0 ? (
                  <p className="text-xs text-[#9B9890]">No contact lists yet — import one in Contacts first.</p>
                ) : (
                  <div className="border border-[#E3E1DB] rounded-lg max-h-44 overflow-y-auto">
                    {pickableLists.map(l => (
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

              {/* Monitor / canary numbers — daily heartbeat */}
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-2">Monitor numbers <span className="text-[#9B9890] font-normal">(optional)</span></label>
                <p className="text-[11px] text-[#9B9890] mb-2">
                  Your own numbers get this voicemail <strong>once per day</strong> while the campaign runs — separate from the lists — so you can confirm each day’s drip fired. One per line.
                </p>
                <textarea
                  value={monitorInput}
                  onChange={(e) => setMonitorInput(e.target.value)}
                  rows={4}
                  placeholder={'+12223334444\n+13334445555'}
                  className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                />
                {monitorNumbers.length > 0 && (
                  <p className="text-[11px] text-[#9B9890] mt-1.5">
                    {monitorNumbers.length} monitor number{monitorNumbers.length === 1 ? '' : 's'} · {(monitorNumbers.length * 2).toLocaleString()} credits/day while running.
                  </p>
                )}
              </div>
            </div>
            </section>
          )}

          {/* ─── Step 3: Chunks & Preview (full audience editor) ─── */}
          {step === 3 && (() => {
            // Filter + paginate the visible chunk recipients (memoized above).
            const q = searchQuery.trim().toLowerCase()
            const filtered = searchFiltered
            const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
            const page = Math.min(currentPage, totalPages)
            const pageStart = (page - 1) * PAGE_SIZE
            const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE)
            const selectedCount = chunkRecipients.length - excludedPhones.size
            const filteredSelected = filteredSelectedCount
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
            // projFirstMs / projLastMs come from the memoized simulation above.
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

                {/* Monitor / canary lines — a reminder of who gets the daily
                    confirmation drip, separate from the recipient list below. */}
                {monitorNumbers.length > 0 && (
                  <div className="bg-white border border-[#E3E1DB] rounded-lg p-3.5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-[#5C5A55] font-semibold">Monitor {monitorNumbers.length === 1 ? 'line' : 'lines'}</p>
                        <p className="text-[11px] text-[#9B9890] mt-0.5">Gets the voicemail once at launch, then once per day while running — separate from the {selectedRecipients.length.toLocaleString()} recipients below.</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] text-[#9B9890]">{(monitorNumbers.length * 2).toLocaleString()} credits/day</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {monitorNumbers.map((p, i) => (
                        <span key={p + i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono text-[#131210] bg-[#F7F6F3] border border-[#E3E1DB]">
                          <i className="fas fa-satellite-dish text-[10px] text-[#9B9890]" />{p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* ─── Landline scrub (Telnyx carrier lookup) ─── */}
                {selectedRecipients.length > 0 && (() => {
                  const uniqueCount = uniqueSelectedCount
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
                          <span className="flex-shrink-0 text-sm text-[#5C5A55] flex items-center gap-2">
                            <i className="fas fa-spinner fa-spin" />
                            {scanProgress ? `Checking carriers… ${scanProgress.done.toLocaleString()} / ${scanProgress.total.toLocaleString()}` : 'Checking carriers…'}
                          </span>
                        )}
                      </div>

                      {!scan && (
                        <p className="text-[11px] text-[#9B9890] mt-2">Up to <strong>{(uniqueCount * 0.5).toLocaleString()} credits</strong> (0.5 each). Scanned in batches; numbers checked before are free.</p>
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

                {/* ─── Save the kept selection as a reusable list ─── */}
                {selectedRecipients.length > 0 && (
                  <div className="bg-white border border-[#E3E1DB] rounded-lg p-3.5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-[#5C5A55] font-semibold">Save as a contact list</p>
                        <p className="text-[11px] text-[#9B9890] mt-0.5">
                          Bank these {saveCandidateCount.toLocaleString()} contacts as a reusable list.
                          {scan && scan.byPhone ? ' Carrier types are saved with them — re-scanning this list later is free.' : ''}
                        </p>
                      </div>
                      {!saveListOpen && (
                        <button type="button" onClick={() => { setSaveListOpen(true); setSavedList(null); setSaveListError('') }}
                          className="flex-shrink-0 px-3 py-1.5 text-sm rounded-md border border-[#D4D1C9] text-[#131210] hover:bg-[#F7F6F3] flex items-center gap-2">
                          <i className="fas fa-bookmark text-[11px]" /> Save as list
                        </button>
                      )}
                    </div>

                    {saveListOpen && (
                      <div className="mt-3 space-y-3">
                        {/* Carrier-type filter — only meaningful after a scan */}
                        {scan && scan.byPhone && (
                          <div>
                            <p className="text-[11px] text-[#5C5A55] mb-1.5">Include which numbers?</p>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { k: 'mobile', label: 'Mobile', color: '#16A34A' },
                                { k: 'voip', label: 'VoIP', color: '#2563EB' },
                                { k: 'landline', label: 'Landline', color: '#D63B1F' },
                                { k: 'unknown', label: 'Unknown', color: '#6B7280' },
                              ].filter(t => saveTypeCounts[t.k] > 0).map(t => {
                                const on = saveTypes.has(t.k)
                                return (
                                  <button key={t.k} type="button" onClick={() => toggleSaveType(t.k)}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${on ? '' : 'opacity-50'}`}
                                    style={{ color: t.color, background: on ? `${t.color}14` : '#F7F6F3', borderColor: on ? `${t.color}40` : '#E3E1DB' }}>
                                    <i className={`fas ${on ? 'fa-check' : 'fa-plus'} text-[9px]`} />
                                    {t.label} <strong>{saveTypeCounts[t.k].toLocaleString()}</strong>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={saveListName}
                            onChange={(e) => { setSaveListName(e.target.value); setSaveListError('') }}
                            placeholder="New list name…"
                            className="flex-1 min-w-[200px] px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                          />
                          <button type="button" onClick={handleSaveAsList} disabled={savingList || saveCandidateCount === 0}
                            className="px-3 py-2 text-sm rounded-md bg-[#131210] text-white hover:bg-black disabled:opacity-50 flex items-center gap-2 whitespace-nowrap">
                            {savingList ? <><i className="fas fa-spinner fa-spin" /> Saving…</> : <>Save {saveCandidateCount.toLocaleString()} contacts</>}
                          </button>
                          <button type="button" onClick={() => { setSaveListOpen(false); setSaveListError('') }}
                            className="px-3 py-2 text-sm rounded-md border border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3]">
                            Cancel
                          </button>
                        </div>
                        {saveListError && <p className="text-xs text-red-600">{saveListError}</p>}
                      </div>
                    )}

                    {savedList && (
                      <p className="text-sm text-green-700 mt-2.5">
                        <i className="fas fa-check-circle mr-1" /> Saved “{savedList.name}” with {savedList.inserted.toLocaleString()} contact{savedList.inserted === 1 ? '' : 's'} — it’s ready to reuse on the Audience step.
                      </p>
                    )}
                  </div>
                )}

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
                      onClick={() => setExcludedFor(pageRows, pageAllSelected)}
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
              ...(monitorNumbers.length > 0 ? [['Monitor', `${monitorNumbers.length} number${monitorNumbers.length === 1 ? '' : 's'} · daily`]] : []),
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

                {/* Cost — pay-as-you-send. Credits are charged per voicemail at
                    the moment it's sent, NOT upfront. The figure below is the
                    maximum if every recipient is sent; pausing stops the charges. */}
                <div className="bg-[#131210] text-white rounded-lg p-4">
                  <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1">Estimated cost — if all are sent</p>
                      <p className="text-2xl font-semibold leading-none">{credits.toLocaleString()} <span className="text-base font-normal text-white/60">credits</span></p>
                      <p className="text-[11px] text-white/50 mt-1">{vmCount.toLocaleString()} voicemail{vmCount === 1 ? '' : 's'} × {RVM_CREDITS_PER_VM} credits each</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold leading-none text-[#FF7A5C]">{usd(dollarValue)}</p>
                      <p className="text-[11px] text-white/50 mt-1">≈ at ${plan.rate.toFixed(2)}/credit · {plan.name}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/10 text-[11px] text-white/70 leading-relaxed space-y-1.5">
                    <p>
                      <i className="fas fa-circle-info mr-1.5 text-white/40" />
                      You're charged <strong className="text-white">{RVM_CREDITS_PER_VM} credits per voicemail</strong>, deducted <strong className="text-white">as each one is sent</strong> — not upfront. <strong className="text-white">Pause the campaign anytime</strong> to stop further charges; you only pay for voicemails actually sent.
                    </p>
                    <p>
                      {overageCredits === 0
                        ? <>Sending all {vmCount.toLocaleString()} would use <strong className="text-white">{credits.toLocaleString()}</strong> of your <strong className="text-white">{balance.toLocaleString()}</strong> credits — <strong className="text-white">{leftAfter.toLocaleString()}</strong> left after.</>
                        : <>Your balance is <strong className="text-white">{balance.toLocaleString()}</strong> — <strong className="text-[#FF7A5C]">{overageCredits.toLocaleString()} short</strong> of sending the full list. The campaign auto-pauses when credits run out; top up to resume.</>}
                    </p>
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {/* Save as draft — stash a complete, ready-to-send campaign without
              launching it. Disabled until everything needed to launch is set,
              since a draft is launched (not re-edited) from the campaign list. */}
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={!canSaveDraft || isSavingDraft || isSubmitting}
            title={canSaveDraft ? 'Save without sending — launch it later from the campaign list' : 'Add a name, sender number, audio, contact list and recipients to save a draft'}
            className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isSavingDraft ? <><i className="fas fa-spinner fa-spin text-xs" />Saving…</> : <><i className="fas fa-bookmark text-xs" />Save as draft</>}
          </button>
        </div>
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

function ViewRVMCampaignModal({ campaign: initialCampaign, contactLists, onClose, onEdit, onLaunch, onDelete }) {
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

  // Reporting tracks DISPATCH only — how many contacts we've handed to VoiceDrop.
  // We deliberately don't surface Delivered / Not-delivered: VoiceDrop's delivery
  // callbacks aren't reliably reported, so "Sent vs Remaining" is the only honest,
  // accurate progress we can show. Prefer the recipients endpoint's UNCAPPED
  // summary counts (accurate for 15k+ lists and before total_recipients is set);
  // fall back to the campaign row's counters while the summary is still loading.
  const dispatched = Number(summary?.dispatched ?? campaign.sent_count ?? 0)   // handed to VoiceDrop
  const total = Number(summary?.total ?? campaign.total_recipients ?? 0)
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
          {/* Out-of-credits banner — paused automatically; resume after top-up. */}
          {campaign.status === 'paused' && campaign.paused_reason === 'insufficient_credits' && (
            <div className="bg-[#FFF8F6] border border-[rgba(214,59,31,0.3)] rounded-lg p-3.5 flex items-start gap-3">
              <i className="fas fa-circle-exclamation text-[#D63B1F] mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-[#131210]">Paused — out of credits</p>
                <p className="text-xs text-[#9B9890] mt-0.5">{remaining.toLocaleString()} recipients are still queued. Top up your wallet, then resume to finish the rest.</p>
              </div>
              <button
                onClick={togglePause}
                disabled={isTogglingPause}
                className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c4351b] rounded-md disabled:opacity-50"
              >
                {isTogglingPause ? 'Resuming…' : 'Resume'}
              </button>
            </div>
          )}
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

          {/* Simple progress — Sent vs Remaining. We intentionally do NOT show
              Delivered / Not-delivered here: VoiceDrop's delivery callbacks are
              not reliably reported, so those numbers would be misleading. "Sent"
              = handed off to VoiceDrop (the real, accurate signal we have). */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Sent contacts', value: processed, icon: 'fa-paper-plane', color: 'text-green-600' },
              { label: 'Remaining contacts', value: remaining, icon: 'fa-hourglass-half', color: 'text-[#9B9890]' },
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

          {Array.isArray(campaign.monitor_numbers) && campaign.monitor_numbers.length > 0 && (
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-2">Monitor {campaign.monitor_numbers.length === 1 ? 'line' : 'lines'}</p>
              <div className="flex flex-wrap gap-1.5">
                {campaign.monitor_numbers.map((p, i) => (
                  <span key={p + i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono text-[#131210] bg-[#F7F6F3] border border-[#E3E1DB]">
                    <i className="fas fa-satellite-dish text-[10px] text-[#9B9890]" />{p}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-[#9B9890] mt-1.5">Receives the voicemail at launch and once per day while running — separate from the recipient list.</p>
            </div>
          )}

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
            <>
              <button
                onClick={handleLaunch}
                disabled={isLaunching}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md transition-colors disabled:opacity-50"
              >
                {isLaunching ? <><i className="fas fa-spinner fa-spin text-xs"></i> Launching…</> : <><i className="fas fa-rocket text-xs"></i> Launch Campaign</>}
              </button>
              {onEdit && (
                <button
                  onClick={onEdit}
                  disabled={isLaunching}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium text-[#5C5A55] border border-[#D4D1C9] rounded-md hover:bg-[#F7F6F3] transition-colors disabled:opacity-50"
                >
                  <i className="fas fa-pen text-xs"></i> Edit
                </button>
              )}
            </>
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
  // Require the user to type the exact campaign name before deleting, so a stray
  // click can't wipe a campaign. Match is trimmed but case-sensitive.
  const [typed, setTyped] = useState('')
  const target = String(campaignName ?? '').trim()
  const matches = typed.trim() === target && target.length > 0

  const handleConfirm = () => { if (matches) onConfirm() }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">Delete Campaign</h3></div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-[#5C5A55]">
            This will permanently delete <span className="font-medium text-[#131210]">&ldquo;{campaignName}&rdquo;</span>. This cannot be undone.
          </p>
          <div>
            <label className="block text-xs text-[#5C5A55] mb-1.5">
              Type <span className="font-semibold text-[#131210]">{campaignName}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
              autoFocus
              placeholder="Enter campaign name"
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!matches}
            className={`px-3 py-1.5 text-sm font-medium text-white rounded-md transition-colors ${matches ? 'bg-[#D63B1F] hover:bg-[#c4351b]' : 'bg-[#E3A799] cursor-not-allowed'}`}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
