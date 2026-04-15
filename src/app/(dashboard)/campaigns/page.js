// app/campaigns/page.jsx
'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

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

  useEffect(() => {
    fetchCampaigns()
    const interval = setInterval(fetchCampaigns, 5000)
    return () => clearInterval(interval)
  }, [fetchCampaigns])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = getCurrentUser()
        setUser(user)
        const [contactListRes, phoneNumberRes] = await Promise.all([
          apiGet('/api/contact-lists'),
          apiGet('/api/phone-numbers'),
        ])
        const contactListData = await contactListRes.json()
        const phoneNumberData = await phoneNumberRes.json()
        if (contactListData.success) setContactLists(contactListData.contactLists || [])
        if (phoneNumberData.success) setPhoneNumbers(phoneNumberData.phoneNumbers || [])
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

  useEffect(() => { setCurrentPage(1) }, [searchTerm, statusFilter])

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
    return { label: 'Active', className: 'bg-green-50 text-green-700' }
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

        {/* Main Card */}
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
          {/* Card Header */}
          <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-[#131210] flex-shrink-0">Campaigns</h3>
              <div className="relative flex-1 max-w-xs">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                <input
                  type="text"
                  placeholder="Search campaigns…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm text-[#5C5A55] focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <button
              onClick={() => setShowCreateCampaign(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors flex-shrink-0"
            >
              <i className="fas fa-plus text-xs"></i>
              New Campaign
            </button>
          </div>

          {/* Table */}
          {paginatedCampaigns.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-[#9B9890]">No campaigns found</p>
              <p className="text-xs text-[#9B9890] mt-1">
                {campaigns.length === 0 ? 'Create your first campaign to get started' : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
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
                        <tr
                          key={campaign.id}
                          className="hover:bg-[#F7F6F3] cursor-pointer"
                          onClick={() => { setSelectedCampaign(campaign); setShowViewCampaign(true) }}
                        >
                          <td className="px-5 py-3">
                            <p className="text-sm font-medium text-[#131210]">{campaign.name}</p>
                            <p className="text-xs text-[#9B9890] truncate max-w-xs mt-0.5">{campaign.message_template}</p>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.contact_list_names?.join(', ') || 'Unknown'}</td>
                          <td className="px-5 py-3 text-sm text-[#5C5A55]">{campaign.total_recipients}</td>
                          <td className="px-5 py-3 text-sm text-[#9B9890] whitespace-nowrap">{formatDate(campaign.created_at)}</td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                title="View"
                                onClick={(e) => { e.stopPropagation(); setSelectedCampaign(campaign); setShowViewCampaign(true) }}
                                className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"
                              >
                                <i className="fas fa-eye text-[13px]"></i>
                              </button>
                              <button
                                title={campaign.status === 'paused' ? 'Resume' : 'Pause'}
                                onClick={(e) => { e.stopPropagation(); handlePauseCampaign(campaign.id, campaign.status === 'paused') }}
                                className="p-1.5 text-[#9B9890] hover:text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                              >
                                <i className={`fas ${campaign.status === 'paused' ? 'fa-play' : 'fa-pause'} text-[13px]`}></i>
                              </button>
                              <button
                                title={campaign.status === 'archived' ? 'Unarchive' : 'Archive'}
                                onClick={(e) => { e.stopPropagation(); handleArchiveCampaign(campaign.id, campaign.status === 'archived') }}
                                className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"
                              >
                                <i className="fas fa-archive text-[13px]"></i>
                              </button>
                              <button
                                title="Delete"
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ campaignId: campaign.id, campaignName: campaign.name }) }}
                                className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"
                              >
                                <i className="fas fa-trash text-[13px]"></i>
                              </button>
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
                  <p className="text-xs text-[#9B9890]">
                    {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredCampaigns.length)} of {filteredCampaigns.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"
                    >
                      <i className="fas fa-angle-left"></i>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                          currentPage === page
                            ? 'bg-[#D63B1F] text-white border-[#D63B1F]'
                            : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"
                    >
                      <i className="fas fa-angle-right"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
          onClose={() => { setShowViewCampaign(false); setSelectedCampaign(null) }}
          onCampaignUpdated={() => fetchCampaigns()}
          onPause={() => handlePauseCampaign(selectedCampaign.id, selectedCampaign.status === 'paused')}
          onArchive={() => handleArchiveCampaign(selectedCampaign.id, selectedCampaign.status === 'archived')}
          onDelete={() => setDeleteConfirm({ campaignId: selectedCampaign.id, campaignName: selectedCampaign.name })}
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
    </div>
  )
}

function SearchableDropdown({ value, onChange, options, placeholder, renderOption, renderSelected, error }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  const selected = options.find(o => o.value === value)

  const filtered = options.filter(o =>
    (o.searchText || '').toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const displayValue = open ? search : (selected ? renderSelected(selected) : '')

  return (
    <div className="relative" ref={ref}>
      <div className={`flex items-center border rounded-lg bg-[#FFFFFF] transition-colors ${
        error ? 'border-[#D63B1F]' : open ? 'border-[#D63B1F] ring-2 ring-[#D63B1F]/20' : 'border-[#D4D1C9]'
      }`}>
        <svg className="w-4 h-4 text-[#9B9890] ml-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={selected ? '' : placeholder}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setSearch('') }}
          className="flex-1 px-3 py-3 text-sm bg-transparent outline-none text-[#131210] placeholder-[#9B9890] min-w-0"
        />
        {selected && !open && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); setSearch('') }}
            className="p-2 text-[#D4D1C9] hover:text-[#9B9890] flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        )}
        <svg className={`w-4 h-4 text-[#9B9890] mr-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[#9B9890] text-center">No results found</p>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(o.value); setOpen(false); setSearch('') }}
                className={`w-full text-left px-4 py-3 hover:bg-[#F7F6F3] transition-colors border-b border-[#EFEDE8] last:border-0 ${value === o.value ? 'bg-[rgba(214,59,31,0.07)]' : ''}`}
              >
                {renderOption(o)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateCampaignModal({ contactLists, phoneNumbers, onClose, onCampaignCreated }) {
  const [formData, setFormData] = useState({
    name: '',
    message: '',
    contactListId: '',
    phoneNumberId: '',
    scheduleTime: '',
    scheduleType: 'immediate',
  })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [created, setCreated] = useState(false)

  const contactListOptions = contactLists.map(cl => ({
    value: cl.id,
    label: cl.name,
    count: cl.contactCount ?? cl.contact_count ?? 0,
    searchText: cl.name,
  }))

  const phoneNumberOptions = phoneNumbers.map(pn => ({
    value: pn.id,
    number: pn.phone_number || pn.phoneNumber,
    name: pn.custom_name || pn.prefix || '',
    searchText: `${pn.custom_name || ''} ${pn.phone_number || pn.phoneNumber || ''}`,
  }))

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Campaign name is required'
    if (!formData.message.trim()) newErrors.message = 'Message is required'
    if (!formData.contactListId) newErrors.contactListId = 'Contact list is required'
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
      const payload = {
        name: formData.name,
        message_template: formData.message,
        contact_list_ids: [formData.contactListId],
        sender_number: senderNumber,
        delay_between_messages: 1000,
      }
      const response = await apiPost('/api/campaigns', payload)
      const data = await response.json()
      if (data.success) {
        setCreated(true)
      } else {
        setErrors({ submit: data.error || 'Failed to create campaign' })
      }
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
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="fas fa-check text-green-600"></i>
            </div>
            <h3 className="text-sm font-semibold text-[#131210] mb-1">Campaign Created</h3>
            <p className="text-xs text-[#9B9890] mb-4">Your campaign has been created successfully.</p>
            <button onClick={onCampaignCreated} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-[#FFFFFF] rounded-xl shadow-2xl flex flex-col" style={{ width: '90vw', maxWidth: '1100px', height: '88vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#E3E1DB] flex-shrink-0">
          <h3 className="text-lg font-semibold text-[#131210]">New Campaign</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1.5 hover:bg-[#F7F6F3] rounded-md transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>

        {/* Body — two columns */}
        <form onSubmit={handleSubmit} className="flex flex-1 min-h-0">
          {/* Left column */}
          <div className="flex-1 flex flex-col px-8 py-6 border-r border-[#E3E1DB] overflow-y-auto space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#5C5A55] mb-2">Campaign Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Summer Sale Campaign"
                className="w-full px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
              />
              {errors.name && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.name}</p>}
            </div>

            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-medium text-[#5C5A55] mb-2">Message *</label>
              <textarea
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Type your SMS message here…"
                className="w-full flex-1 px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F] resize-none min-h-[200px]"
              />
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-xs text-[#9B9890] font-medium">Insert placeholder:</span>
                {['{first_name}', '{last_name}', '{business_name}'].map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, message: f.message + tag }))}
                    className="px-2.5 py-1 text-xs bg-[#EFEDE8] hover:bg-[#fdecea] hover:text-[#D63B1F] hover:border-[#D63B1F] text-[#5C5A55] rounded-md border border-[#E3E1DB] font-mono transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              {errors.message && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.message}</p>}
            </div>
          </div>

          {/* Right column */}
          <div className="w-96 flex flex-col px-8 py-6 overflow-y-auto space-y-5 flex-shrink-0">
            <div>
              <label className="block text-sm font-medium text-[#5C5A55] mb-2">Contact List *</label>
              <SearchableDropdown
                value={formData.contactListId}
                onChange={(v) => setFormData(f => ({ ...f, contactListId: v }))}
                options={contactListOptions}
                placeholder="Select a list"
                error={errors.contactListId}
                renderSelected={(o) => o.label}
                renderOption={(o) => (
                  <div>
                    <p className="text-sm font-medium text-[#131210]">{o.label}</p>
                    <p className="text-xs text-[#9B9890] mt-0.5">{o.count} contacts</p>
                  </div>
                )}
              />
              {errors.contactListId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.contactListId}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#5C5A55] mb-2">Phone Number *</label>
              <SearchableDropdown
                value={formData.phoneNumberId}
                onChange={(v) => setFormData(f => ({ ...f, phoneNumberId: v }))}
                options={phoneNumberOptions}
                placeholder="Select a number"
                error={errors.phoneNumberId}
                renderSelected={(o) => (
                  <span>{o.name ? `${o.name} — ` : ''}{o.number}</span>
                )}
                renderOption={(o) => (
                  <div>
                    {o.name && <p className="text-sm font-medium text-[#131210]">{o.name}</p>}
                    <p className={`text-sm ${o.name ? 'text-[#9B9890]' : 'font-medium text-[#131210]'}`}>{o.number}</p>
                  </div>
                )}
              />
              {errors.phoneNumberId && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.phoneNumberId}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#5C5A55] mb-2">Schedule</label>
              <div className="space-y-2.5">
                <label className="flex items-center gap-3 p-3 border border-[#E3E1DB] rounded-lg cursor-pointer hover:bg-[#F7F6F3] transition-colors">
                  <input
                    type="radio" value="immediate"
                    checked={formData.scheduleType === 'immediate'}
                    onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value, scheduleTime: '' })}
                    className="text-[#D63B1F]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[#131210]">Send Immediately</p>
                    <p className="text-xs text-[#9B9890]">Starts sending right after creation</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 border border-[#E3E1DB] rounded-lg cursor-pointer hover:bg-[#F7F6F3] transition-colors">
                  <input
                    type="radio" value="scheduled"
                    checked={formData.scheduleType === 'scheduled'}
                    onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value })}
                    className="text-[#D63B1F]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[#131210]">Schedule for Later</p>
                    <p className="text-xs text-[#9B9890]">Pick a date and time</p>
                  </div>
                </label>
              </div>
            </div>

            {formData.scheduleType === 'scheduled' && (
              <div>
                <label className="block text-sm font-medium text-[#5C5A55] mb-2">Schedule Time *</label>
                <input
                  type="datetime-local"
                  value={formData.scheduleTime}
                  onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })}
                  className="w-full px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
                />
                {errors.scheduleTime && <p className="text-[#D63B1F] text-xs mt-1.5">{errors.scheduleTime}</p>}
              </div>
            )}

            {errors.submit && (
              <div className="bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] text-[#D63B1F] px-4 py-3 rounded-lg text-sm">
                {errors.submit}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-8 py-4 border-t border-[#E3E1DB] flex-shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] transition-colors">
            Cancel
          </button>
          <button
            type="submit" form="campaign-form" disabled={isSubmitting}
            onClick={handleSubmit}
            className="px-6 py-2.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-2"></i>Creating…</> : 'Create Campaign'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewCampaignModal({ campaign, contactLists, phoneNumbers, onClose, onCampaignUpdated, onPause, onArchive, onDelete }) {
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
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Campaign Name *</label>
              <input
                type="text"
                value={editFormData.name}
                onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              />
              {errors.name && <p className="text-[#D63B1F] text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Message *</label>
              <textarea
                value={editFormData.message}
                onChange={(e) => setEditFormData({ ...editFormData, message: e.target.value })}
                rows="4"
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none"
              />
              {errors.message && <p className="text-[#D63B1F] text-xs mt-1">{errors.message}</p>}
            </div>
            {errors.submit && (
              <div className="bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] text-[#D63B1F] px-3 py-2.5 rounded-md text-sm">{errors.submit}</div>
            )}
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
              <div>
                <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Campaign Name</p>
                <p className="text-sm text-[#131210] font-medium">{campaign.name}</p>
              </div>
              <div>
                <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Message</p>
                <p className="text-sm text-[#5C5A55] bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 whitespace-pre-wrap">{campaign.message_template}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Contact List', value: campaign.contact_list_names?.join(', ') || 'Unknown' },
                  { label: 'Sender Number', value: campaign.sender_number || 'Unknown' },
                  { label: 'Recipients', value: campaign.total_recipients },
                  { label: 'Created', value: formatDate(campaign.created_at) },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">{item.label}</p>
                    <p className="text-sm text-[#5C5A55]">{item.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Status</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* Execution History */}
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
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        log.status === 'completed' ? 'bg-green-50 text-green-700'
                        : log.status === 'failed' ? 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]'
                        : 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-[#E3E1DB] px-5 py-3.5 flex flex-wrap items-center gap-2">
              <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">Edit</button>
              <button onClick={onPause} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                {campaign.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button onClick={onArchive} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                {campaign.status === 'archived' ? 'Unarchive' : 'Archive'}
              </button>
              <button onClick={onDelete} className="px-3 py-1.5 text-sm text-[#D63B1F] border border-[rgba(214,59,31,0.14)] rounded-md hover:bg-[rgba(214,59,31,0.07)]">Delete</button>
              <button onClick={onClose} className="ml-auto px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[#5C5A55]">{message}</p>
        </div>
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
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">Delete Campaign</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[#5C5A55]">
            Delete <span className="font-medium text-[#131210]">"{campaignName}"</span>? This cannot be undone.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c4351b] rounded-md">Delete</button>
        </div>
      </div>
    </div>
  )
}
