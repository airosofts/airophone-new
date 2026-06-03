// app/campaigns/page.jsx
'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import SearchableDropdown from '@/components/SearchableDropdown'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'
import { formatInTimeZone } from 'date-fns-tz'

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
                  <span className="hidden sm:inline text-[10px] font-medium text-[#9B9890] bg-[#F7F6F3] border border-[#E3E1DB] px-1.5 py-0.5 rounded whitespace-nowrap">Ringless voicemail drops</span>
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

function CreateCampaignModal({ contactLists, phoneNumbers, onClose, onCampaignCreated }) {
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

function CreateRVMCampaignModal({ contactLists, phoneNumbers, onClose, onCreated }) {
  // Step 1 (Basics): name, sender, audio
  // Step 2 (Audience): contact lists + phone columns
  // Step 3 (Chunks & Preview): chunk size + chunk picker + recipient sample
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [senderNumber, setSenderNumber] = useState('')
  const [uploadState, setUploadState] = useState(null) // null | 'uploading' | { url, voicedropUrl, path, name }
  const [selectedListIds, setSelectedListIds] = useState([])
  const [selectedColumns, setSelectedColumns] = useState(['phone_number'])
  const [chunkSize, setChunkSize] = useState(1500)
  const [chunkIndex, setChunkIndex] = useState(1)
  // Sending speed (throttle). mode 'max' = no throttle (as fast as allowed);
  // 'throttled' = throttleCount every (throttleWindowValue × throttleUnit),
  // metered by the cron over time. e.g. 100 every 15 minutes, 1000 every 1 hour.
  const [throttleMode, setThrottleMode] = useState('max')
  const [throttleCount, setThrottleCount] = useState(100)
  const [throttleWindowValue, setThrottleWindowValue] = useState(1)
  const [throttleUnit, setThrottleUnit] = useState('hour')
  const throttleWindowSeconds = Math.max(60, throttleWindowValue * (throttleUnit === 'hour' ? 3600 : 60))
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [created, setCreated] = useState(false)
  const fileInputRef = useRef(null)

  // Preview data (fetched lazily when Step 2 / Step 3 are visible)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [detectedColumns, setDetectedColumns] = useState([])  // [{key,label,count,isPrimary}]
  const [totalRecipients, setTotalRecipients] = useState(0)
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
    setChunkIndex(1)
  }
  const toggleColumn = (k) => {
    setSelectedColumns(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
    setChunkIndex(1)
  }

  // ── Audio upload (unchanged from legacy modal) ─────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadState('uploading')
    setErrors(prev => ({ ...prev, audio: null }))
    const form = new FormData()
    form.append('file', file)
    try {
      const user = getCurrentUser()
      const res = await fetch('/api/voicemail-campaigns/upload-audio', {
        method: 'POST',
        headers: { 'x-workspace-id': user?.workspaceId, 'x-user-id': user?.userId },
        body: form,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setErrors(prev => ({ ...prev, audio: data.error || 'Upload failed' }))
        setUploadState(null)
        return
      }
      setUploadState({ url: data.url, voicedropUrl: data.voicedrop_url, path: data.path, name: file.name })
    } catch {
      setErrors(prev => ({ ...prev, audio: 'Upload failed. Please try again.' }))
      setUploadState(null)
    }
  }

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
      phoneColumns: step === 3 ? selectedColumns : undefined,
      chunkSize: step === 3 ? chunkSize : 0,
      chunkIndex: step === 3 && chunkSize > 0 ? chunkIndex : 0,
    }
    apiPost('/api/voicemail-campaigns/preview', body)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data?.success) {
          setDetectedColumns(data.detectedColumns || [])
          setTotalRecipients(data.totalRecipients || 0)
          setChunkRecipients(data.recipients || [])
          setPreviewTruncated(!!data.truncated)
          setChunks(data.chunks || [])
          setAlreadySentChunks(data.alreadySentChunks || [])
        }
      })
      .catch(() => { /* silent — UI just stays empty */ })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [step, selectedListIds.join(','), selectedColumns.join(','), chunkSize, chunkIndex])

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
  const goNext = () => { if (validateStep(step)) setStep(s => Math.min(3, s + 1)) }
  const goBack = () => { setErrors({}); setStep(s => Math.max(1, s - 1)) }

  // ── Launch ─────────────────────────────────────────────────────────────
  // The exact recipients the user has chosen for THIS launch (after chunk
  // pick + manual unticks + search). The backend will enqueue exactly this set.
  const selectedRecipients = chunkRecipients.filter(r => !excludedPhones.has(r.phone))

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
        throttleCount: throttleMode === 'throttled' ? throttleCount : null,
        throttleWindowSeconds: throttleWindowSeconds,
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
    { 1: 'Basics', 2: 'Audience', 3: 'Chunks & Preview' }[n] || ''
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
          {[1, 2, 3].map(n => {
            const active = step === n
            const done = step > n
            return (
              <div key={n} className="flex items-center gap-1 sm:gap-2 shrink-0">
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-md ${active ? 'bg-[#fdecea]' : ''}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${active ? 'bg-[#D63B1F] text-white' : done ? 'bg-[#1F8C4A] text-white' : 'bg-[#EFEDE8] text-[#9B9890]'}`}>{n}</span>
                  <span className={`text-xs font-medium ${active ? 'text-[#D63B1F]' : done ? 'text-[#5C5A55]' : 'text-[#9B9890]'}`}>{stepLabel(n)}</span>
                </div>
                {n < 3 && <span className="w-4 sm:w-8 h-px bg-[#E3E1DB]" />}
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
                  placeholder="e.g. Reactivate cold leads — June drop"
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
                {!uploadState && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full px-4 py-6 border-2 border-dashed border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55] hover:border-[#D63B1F] hover:bg-[#FFF8F6]"
                  >
                    <i className="fas fa-cloud-upload-alt mr-2" /> Click to upload an MP3
                  </button>
                )}
                {uploadState === 'uploading' && (
                  <div className="px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55]">
                    <i className="fas fa-spinner fa-spin mr-2" /> Uploading…
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

              {/* Sending speed (throttle) */}
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Sending speed</label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="rvm-throttle"
                      checked={throttleMode === 'max'}
                      onChange={() => setThrottleMode('max')}
                      className="w-4 h-4 accent-[#D63B1F]"
                    />
                    <span className="text-sm text-[#131210]">No throttle</span>
                    <span className="text-[11px] text-[#9B9890]">— send as fast as the carrier allows</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="rvm-throttle"
                      checked={throttleMode === 'throttled'}
                      onChange={() => setThrottleMode('throttled')}
                      className="w-4 h-4 accent-[#D63B1F]"
                    />
                    <span className="text-sm text-[#131210]">Throttle</span>
                  </label>
                  {throttleMode === 'throttled' && (
                    <div className="flex items-center gap-2 pl-7 flex-wrap">
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
                      </select>
                    </div>
                  )}
                </div>
                {throttleMode === 'throttled' && (() => {
                  const audience = chunkSize > 0 ? chunkSize : (totalRecipients || 0)
                  const ratePerMin = throttleCount / (throttleWindowSeconds / 60)
                  const etaMin = ratePerMin > 0 ? Math.ceil(audience / ratePerMin) : 0
                  const etaLabel = etaMin >= 60 ? `~${(etaMin / 60).toFixed(1)} hr` : `~${etaMin} min`
                  return (
                    <p className="text-[11px] text-[#9B9890] mt-1.5">
                      e.g. <strong>{throttleCount.toLocaleString()}</strong> voicemails every <strong>{throttleWindowValue} {throttleUnit}{throttleWindowValue === 1 ? '' : 's'}</strong>.
                      {audience > 0 && <> {etaLabel} to finish {audience.toLocaleString()} recipients.</>} Metered so callbacks don’t all come at once.
                    </p>
                  )
                })()}
                {throttleMode === 'max' && (
                  <p className="text-[11px] text-[#9B9890] mt-1.5">Best for small lists or when you can handle callbacks immediately.</p>
                )}
              </div>
            </div>
            </section>
          )}

          {/* ─── Step 2: Audience ─── */}
          {step === 2 && (
            <section className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-5 sm:p-6">
              <h4 className="text-sm font-semibold text-[#131210] mb-1">Audience</h4>
              <p className="text-xs text-[#9B9890] mb-4">Pick the contact lists and which phone columns each contact should be dropped to.</p>
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
                    Pick every column you want a drop to. Each contact gets one voicemail per non-empty column selected.
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

              {selectedListIds.length > 0 && selectedColumns.length > 0 && (
                <div className="px-3 py-2.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg flex items-center gap-2">
                  <i className="fas fa-users text-[#D63B1F]" />
                  <span className="text-sm text-[#131210]">
                    <strong>{totalRecipients.toLocaleString()}</strong> deduped recipients across {selectedColumns.length} column{selectedColumns.length === 1 ? '' : 's'}
                  </span>
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

            return (
              <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
                {/* ─── Left sidebar: audio preview + chunk size + chunks ─── */}
                <div className="space-y-4">
                  {uploadState && uploadState !== 'uploading' && (
                    <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg p-3">
                      <p className="text-[10px] uppercase tracking-wider text-[#9B9890] font-medium mb-1.5">Voicemail audio</p>
                      <p className="text-xs text-[#131210] truncate mb-2">{uploadState.name}</p>
                      <audio controls src={uploadState.url} className="w-full" style={{ height: 34 }} />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Chunk size</label>
                    <input
                      type="number"
                      min={0}
                      value={chunkSize}
                      onChange={(e) => { setChunkSize(Math.max(0, parseInt(e.target.value) || 0)); setChunkIndex(1) }}
                      className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                    />
                    <p className="text-[10px] text-[#9B9890] mt-1">{totalRecipients.toLocaleString()} total · {chunks.length || 1} chunk{(chunks.length || 1) === 1 ? '' : 's'}. Set to 0 to send the whole list.</p>
                  </div>

                  {chunkSize > 0 && chunks.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Pick a chunk</label>
                      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                        {chunks.map(ch => {
                          const sentMeta = alreadySentChunks.find(s => s.n === ch.n)
                          const active = ch.n === chunkIndex
                          return (
                            <button
                              key={ch.n}
                              type="button"
                              onClick={() => setChunkIndex(ch.n)}
                              className={`w-full text-left px-3 py-2 rounded-lg border text-xs ${active ? 'border-[#D63B1F] bg-[#FFF8F6]' : 'border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}
                            >
                              <div className="font-medium text-[#131210] flex items-center gap-1.5">
                                Chunk {ch.n}
                                {sentMeta && <i className="fas fa-check text-green-600 text-[10px]" title={`Launched ${new Date(sentMeta.at).toLocaleDateString()}`} />}
                              </div>
                              <div className="text-[10px] text-[#9B9890]">rows {ch.start.toLocaleString()}–{ch.end.toLocaleString()} · {ch.count.toLocaleString()}</div>
                              {sentMeta && <div className="text-[10px] text-green-700 mt-0.5">Already launched ({sentMeta.status})</div>}
                            </button>
                          )
                        })}
                      </div>
                      {alreadySentChunks.some(s => s.n === chunkIndex) && (
                        <div className="mt-2 px-2.5 py-2 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800 flex items-start gap-1.5">
                          <i className="fas fa-exclamation-triangle mt-0.5" />
                          <span>This chunk was already launched. Re-sending will drop voicemails twice.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ─── Right: searchable, paginated, selectable recipient table ─── */}
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
                      Select all{q ? ' matches' : ' in chunk'}
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
                            <span className="text-[#131210] truncate">{r.name || '—'}</span>
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
                      Showing first 50,000 rows of the chunk (capped). Smaller chunk sizes will show every row.
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
        {step < 3 ? (
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

  const sent = Number(campaign.sent_count || 0)
  const failed = Number(campaign.failed_count || 0)
  const total = Number(campaign.total_recipients || 0)
  const processed = sent + failed
  const remaining = Math.max(0, total - processed)
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

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
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[rgba(214,59,31,0.08)] rounded flex items-center justify-center">
              <i className="fas fa-voicemail text-[#D63B1F] text-xs"></i>
            </div>
            <h3 className="text-sm font-semibold text-[#131210]">RVM Campaign Details</h3>
          </div>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Campaign Name</p>
              <p className="text-sm font-medium text-[#131210]">{campaign.name}</p>
            </div>
            <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${statusClass}`}>{statusLabel}</span>
          </div>

          {/* Live progress — updates every 2.5s via polling.
              Works whether you stay on the tab or close it; the campaign runs
              server-side via the cron sweeper either way. */}
          {total > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-[#9B9890] uppercase tracking-wider">Progress</p>
                <p className="text-xs text-[#5C5A55] font-mono">
                  {processed.toLocaleString()} / {total.toLocaleString()} <span className="text-[#9B9890]">· {pct}%</span>
                </p>
              </div>
              <div className="w-full h-2 bg-[#EFEDE8] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${campaign.status === 'paused' ? 'bg-yellow-400' : campaign.status === 'completed' ? 'bg-green-500' : 'bg-[#D63B1F]'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {(campaign.status === 'running' || campaign.status === 'paused') && (
                <p className="text-[11px] text-[#9B9890] mt-1.5">
                  {campaign.status === 'paused' ? 'Paused' : 'Dispatching'} · {remaining.toLocaleString()} remaining
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Sent', value: sent, icon: 'fa-paper-plane', color: 'text-green-600' },
              { label: 'Failed', value: failed, icon: 'fa-times-circle', color: 'text-[#D63B1F]' },
              { label: 'Remaining', value: remaining, icon: 'fa-clock', color: 'text-[#5C5A55]' },
            ].map(item => (
              <div key={item.label} className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg p-3 text-center">
                <i className={`fas ${item.icon} ${item.color} text-sm mb-1`}></i>
                <p className="text-lg font-semibold text-[#131210]">{item.value.toLocaleString()}</p>
                <p className="text-xs text-[#9B9890]">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Sender Number</p>
              <p className="text-sm text-[#5C5A55]">{campaign.sender_number}</p>
            </div>
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Contact Lists</p>
              <p className="text-sm text-[#5C5A55]">{getContactListName(campaign.contact_list_ids)}</p>
            </div>
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Created</p>
              <p className="text-sm text-[#5C5A55]">{formatDate(campaign.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Sending Speed</p>
              <p className="text-sm text-[#5C5A55]">
                {campaign.throttle_count
                  ? (() => {
                      const w = campaign.throttle_window_seconds || 3600
                      const label = w % 3600 === 0 ? `${w / 3600} hr` : `${Math.round(w / 60)} min`
                      return `${campaign.throttle_count.toLocaleString()} every ${label}`
                    })()
                  : 'No throttle (max speed)'}
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
        </div>

        <div className="border-t border-[#E3E1DB] px-5 py-3.5 flex flex-wrap items-center gap-2">
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
