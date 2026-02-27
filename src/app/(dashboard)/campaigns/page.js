// app/campaigns/page.jsx
'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
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
        if (contactListData.success) setContactLists(contactListData.contact_lists || [])
        if (phoneNumberData.success) setPhoneNumbers(phoneNumberData.phone_numbers || [])
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
    if (campaign.status === 'archived') return { label: 'Archived', className: 'bg-gray-100 text-gray-600' }
    if (campaign.status === 'paused') return { label: 'Paused', className: 'bg-yellow-50 text-yellow-700' }
    if (campaign.status === 'running') return { label: 'Running', className: 'bg-blue-50 text-blue-700' }
    if (campaign.status === 'completed') return { label: 'Completed', className: 'bg-purple-50 text-purple-700' }
    return { label: 'Active', className: 'bg-green-50 text-green-700' }
  }

  if (loading) {
    return (
      <div className="h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin text-2xl text-gray-400 mb-3"></i>
          <p className="text-sm text-gray-500">Loading campaigns…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-gray-50 overflow-auto">
      <div className="p-6 space-y-4">

        {/* Main Card */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {/* Card Header */}
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 flex-shrink-0">Campaigns</h3>
              <div className="relative flex-1 max-w-xs">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input
                  type="text"
                  placeholder="Search campaigns…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <button
              onClick={() => setShowCreateCampaign(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors flex-shrink-0"
            >
              <i className="fas fa-plus text-xs"></i>
              New Campaign
            </button>
          </div>

          {/* Table */}
          {paginatedCampaigns.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-500">No campaigns found</p>
              <p className="text-xs text-gray-400 mt-1">
                {campaigns.length === 0 ? 'Create your first campaign to get started' : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Campaign</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Contact List</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Recipients</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedCampaigns.map((campaign) => {
                      const status = getStatusBadge(campaign)
                      return (
                        <tr
                          key={campaign.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => { setSelectedCampaign(campaign); setShowViewCampaign(true) }}
                        >
                          <td className="px-5 py-3">
                            <p className="text-sm font-medium text-gray-900">{campaign.name}</p>
                            <p className="text-xs text-gray-400 truncate max-w-xs mt-0.5">{campaign.message_template}</p>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.className}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-600">{campaign.contact_list_names?.join(', ') || 'Unknown'}</td>
                          <td className="px-5 py-3 text-sm text-gray-600">{campaign.total_recipients}</td>
                          <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(campaign.created_at)}</td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                title="View"
                                onClick={(e) => { e.stopPropagation(); setSelectedCampaign(campaign); setShowViewCampaign(true) }}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                              >
                                <i className="fas fa-eye text-[13px]"></i>
                              </button>
                              <button
                                title={campaign.status === 'paused' ? 'Resume' : 'Pause'}
                                onClick={(e) => { e.stopPropagation(); handlePauseCampaign(campaign.id, campaign.status === 'paused') }}
                                className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                              >
                                <i className={`fas ${campaign.status === 'paused' ? 'fa-play' : 'fa-pause'} text-[13px]`}></i>
                              </button>
                              <button
                                title={campaign.status === 'archived' ? 'Unarchive' : 'Archive'}
                                onClick={(e) => { e.stopPropagation(); handleArchiveCampaign(campaign.id, campaign.status === 'archived') }}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                              >
                                <i className="fas fa-archive text-[13px]"></i>
                              </button>
                              <button
                                title="Delete"
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ campaignId: campaign.id, campaignName: campaign.name }) }}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
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
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
                  <p className="text-xs text-gray-500">
                    {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredCampaigns.length)} of {filteredCampaigns.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-left"></i>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                          currentPage === page
                            ? 'bg-[#C54A3F] text-white border-[#C54A3F]'
                            : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
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
      const senderNumber = phoneNumbers.find(pn => pn.id === formData.phoneNumberId)?.phone_number
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
        <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
          <div className="px-5 py-8 text-center">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="fas fa-check text-green-600"></i>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Campaign Created</h3>
            <p className="text-xs text-gray-500 mb-4">Your campaign has been created successfully.</p>
            <button onClick={onCampaignCreated} className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-sm font-semibold text-gray-900">New Campaign</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Campaign Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Summer Sale Campaign"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Message *</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              placeholder="Enter your SMS message here…"
              rows="4"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F] resize-none"
            />
            {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Contact List *</label>
              <select
                value={formData.contactListId}
                onChange={(e) => setFormData({ ...formData, contactListId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              >
                <option value="">Select a list</option>
                {contactLists.map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.name} ({cl.contact_count} contacts)</option>
                ))}
              </select>
              {errors.contactListId && <p className="text-red-500 text-xs mt-1">{errors.contactListId}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone Number *</label>
              <select
                value={formData.phoneNumberId}
                onChange={(e) => setFormData({ ...formData, phoneNumberId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              >
                <option value="">Select a number</option>
                {phoneNumbers.map((pn) => (
                  <option key={pn.id} value={pn.id}>{pn.phone_number}</option>
                ))}
              </select>
              {errors.phoneNumberId && <p className="text-red-500 text-xs mt-1">{errors.phoneNumberId}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Schedule</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" value="immediate"
                  checked={formData.scheduleType === 'immediate'}
                  onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value, scheduleTime: '' })}
                  className="text-[#C54A3F]"
                />
                <span className="text-sm text-gray-700">Send Immediately</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio" value="scheduled"
                  checked={formData.scheduleType === 'scheduled'}
                  onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value })}
                  className="text-[#C54A3F]"
                />
                <span className="text-sm text-gray-700">Schedule for Later</span>
              </label>
            </div>
          </div>

          {formData.scheduleType === 'scheduled' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Schedule Time *</label>
              <input
                type="datetime-local"
                value={formData.scheduleTime}
                onChange={(e) => setFormData({ ...formData, scheduleTime: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              />
              {errors.scheduleTime && <p className="text-red-500 text-xs mt-1">{errors.scheduleTime}</p>}
            </div>
          )}

          {errors.submit && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-md text-sm">
              {errors.submit}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
            <button
              type="submit" disabled={isSubmitting}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50"
            >
              {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Creating…</> : 'Create Campaign'}
            </button>
          </div>
        </form>
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
  const statusClass = campaign.status === 'archived' ? 'bg-gray-100 text-gray-600' : campaign.status === 'paused' ? 'bg-yellow-50 text-yellow-700' : campaign.status === 'running' ? 'bg-blue-50 text-blue-700' : campaign.status === 'completed' ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-sm font-semibold text-gray-900">{isEditing ? 'Edit Campaign' : 'Campaign Details'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Campaign Name *</label>
              <input
                type="text"
                value={editFormData.name}
                onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Message *</label>
              <textarea
                value={editFormData.message}
                onChange={(e) => setEditFormData({ ...editFormData, message: e.target.value })}
                rows="4"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F] resize-none"
              />
              {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message}</p>}
            </div>
            {errors.submit && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-md text-sm">{errors.submit}</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setIsEditing(false); setErrors({}) }} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50">
                {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</> : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Campaign Name</p>
                <p className="text-sm text-gray-900 font-medium">{campaign.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Message</p>
                <p className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded px-3 py-2 whitespace-pre-wrap">{campaign.message_template}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Contact List', value: campaign.contact_list_names?.join(', ') || 'Unknown' },
                  { label: 'Sender Number', value: campaign.sender_number || 'Unknown' },
                  { label: 'Recipients', value: campaign.total_recipients },
                  { label: 'Created', value: formatDate(campaign.created_at) },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{item.label}</p>
                    <p className="text-sm text-gray-700">{item.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Status</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* Execution History */}
            <div className="border-t border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Execution History</p>
              {loadingLogs ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : executionLogs.length === 0 ? (
                <p className="text-sm text-gray-400">No execution logs yet</p>
              ) : (
                <div className="space-y-2">
                  {executionLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded px-3 py-2">
                      <div>
                        <p className="text-sm text-gray-700">{formatDate(log.executed_at)}</p>
                        <p className="text-xs text-gray-400">{log.sent_count} sent, {log.failed_count} failed</p>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        log.status === 'completed' ? 'bg-green-50 text-green-700'
                        : log.status === 'failed' ? 'bg-red-50 text-red-700'
                        : 'bg-blue-50 text-blue-700'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-gray-100 px-5 py-3.5 flex flex-wrap items-center gap-2">
              <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md">Edit</button>
              <button onClick={onPause} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">
                {campaign.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button onClick={onArchive} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">
                {campaign.status === 'archived' ? 'Unarchive' : 'Archive'}
              </button>
              <button onClick={onDelete} className="px-3 py-1.5 text-sm text-red-600 border border-red-100 rounded-md hover:bg-red-50">Delete</button>
              <button onClick={onClose} className="ml-auto px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Close</button>
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">{message}</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmationModal({ campaignName, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Delete Campaign</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">
            Delete <span className="font-medium text-gray-900">"{campaignName}"</span>? This cannot be undone.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">Delete</button>
        </div>
      </div>
    </div>
  )
}
