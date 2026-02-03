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

  // Filter states
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' })

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Fetch campaigns with auto-refresh for running campaigns
  const fetchCampaigns = useCallback(async () => {
    try {
      if (!loading) {
        // Silent refresh, don't show loading spinner
        const response = await apiGet('/api/campaigns')
        const data = await response.json()
        if (data.success) {
          setCampaigns(data.campaigns)
        }
      } else {
        // Initial load with spinner
        setLoading(true)
        const response = await apiGet('/api/campaigns')
        const data = await response.json()
        if (data.success) {
          setCampaigns(data.campaigns)
        }
        setLoading(false)
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error)
      if (loading) setLoading(false)
    }
  }, [loading])

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)

    const fetchData = async () => {
      await Promise.all([
        fetchCampaigns(),
        fetchContactLists(),
        fetchPhoneNumbers()
      ])
    }

    fetchData()
  }, [])

  // Auto-refresh every 5 seconds if there are running campaigns
  useEffect(() => {
    const hasRunningCampaigns = campaigns.some(c => c.status === 'running')
    
    if (hasRunningCampaigns) {
      const interval = setInterval(() => {
        fetchCampaigns()
      }, 5000) // Refresh every 5 seconds
      
      return () => clearInterval(interval)
    }
  }, [campaigns, fetchCampaigns])

  const fetchContactLists = async () => {
    try {
      const response = await apiGet('/api/contact-lists')
      const data = await response.json()
      if (data.success) {
        setContactLists(data.contactLists)
      }
    } catch (error) {
      console.error('Error fetching contact lists:', error)
    }
  }

  const fetchPhoneNumbers = async () => {
    try {
      const response = await apiGet('/api/phone-numbers')
      const data = await response.json()
      if (data.success) {
        setPhoneNumbers(data.phoneNumbers)
      }
    } catch (error) {
      console.error('Error fetching phone numbers:', error)
    }
  }


  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    
    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const getStatusConfig = (status) => {
    switch (status) {
      case 'draft':
        return { color: 'bg-gray-100 text-gray-800', icon: 'fa-file-alt' }
      case 'running':
        return { color: 'bg-blue-100 text-blue-800', icon: 'fa-play-circle' }
      case 'paused':
        return { color: 'bg-yellow-100 text-yellow-800', icon: 'fa-pause-circle' }
      case 'completed':
        return { color: 'bg-green-100 text-green-800', icon: 'fa-check-circle' }
      case 'failed':
        return { color: 'bg-red-100 text-red-800', icon: 'fa-times-circle' }
      default:
        return { color: 'bg-gray-100 text-gray-800', icon: 'fa-question-circle' }
    }
  }

  const startCampaign = async (campaignId) => {
    try {
      const response = await apiPost(`/api/campaigns/${campaignId}/start`, {})
      const data = await response.json()

      if (data.success) {
        fetchCampaigns()
      } else {
        setErrorModal({
          title: 'Failed to Start Campaign',
          message: data.error || 'An error occurred while starting the campaign.'
        })
      }
    } catch (error) {
      console.error('Error starting campaign:', error)
      setErrorModal({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const stopCampaign = async (campaignId) => {
    try {
      const response = await apiPost(`/api/campaigns/${campaignId}/stop`, {})
      const data = await response.json()

      if (data.success) {
        fetchCampaigns()
      } else {
        setErrorModal({
          title: 'Failed to Stop Campaign',
          message: data.error || 'An error occurred while stopping the campaign.'
        })
      }
    } catch (error) {
      console.error('Error stopping campaign:', error)
      setErrorModal({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const deleteCampaign = async (campaignId) => {
    try {
      const response = await fetchWithWorkspace(`/api/campaigns?id=${campaignId}`, {
        method: 'DELETE'
      })
      const data = await response.json()
      
      if (data.success) {
        setCampaigns(campaigns.filter(c => c.id !== campaignId))
        setDeleteConfirm(null)
        
        // Adjust current page if needed
        const newTotalPages = Math.ceil((filteredCampaigns.length - 1) / itemsPerPage)
        if (currentPage > newTotalPages && newTotalPages > 0) {
          setCurrentPage(newTotalPages)
        }
      } else {
        setDeleteConfirm(null)
        setErrorModal({
          title: 'Failed to Delete Campaign',
          message: data.error || 'An error occurred while deleting the campaign.'
        })
      }
    } catch (error) {
      console.error('Error deleting campaign:', error)
      setDeleteConfirm(null)
      setErrorModal({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const formatDate = (dateString) => {
    // Convert to EST timezone
    return formatInTimeZone(new Date(dateString), 'America/New_York', 'MMM d, yyyy h:mm a')
  }

  // Filter campaigns
  const filteredCampaigns = useMemo(() => {
    let filtered = campaigns.filter(campaign => {
      // Search filter
      const matchesSearch = campaign.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           campaign.message_template.toLowerCase().includes(searchTerm.toLowerCase())
      
      // Status filter
      const matchesStatus = statusFilter === 'all' || campaign.status === statusFilter
      
      // Date filter
      let matchesDate = true
      const campaignDate = new Date(campaign.created_at)
      const now = new Date()
      
      switch (dateFilter) {
        case 'today':
          matchesDate = campaignDate.toDateString() === now.toDateString()
          break
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          matchesDate = campaignDate >= weekAgo
          break
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          matchesDate = campaignDate >= monthAgo
          break
        case 'custom':
          if (customDateRange.start && customDateRange.end) {
            const startDate = new Date(customDateRange.start)
            const endDate = new Date(customDateRange.end)
            endDate.setHours(23, 59, 59, 999)
            matchesDate = campaignDate >= startDate && campaignDate <= endDate
          }
          break
        default:
          matchesDate = true
      }
      
      return matchesSearch && matchesStatus && matchesDate
    })
    
    return filtered
  }, [campaigns, searchTerm, statusFilter, dateFilter, customDateRange])

  // Pagination
  const totalPages = Math.ceil(filteredCampaigns.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentCampaigns = filteredCampaigns.slice(startIndex, endIndex)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, statusFilter, dateFilter, customDateRange])

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage and monitor your bulk messaging campaigns
            </p>
          </div>
          <button
            onClick={() => setShowCreateCampaign(true)}
            className="px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] rounded-xl hover:from-[#B73E34] hover:to-[#A53329] transition-all shadow-lg hover:shadow-xl flex items-center space-x-2"
          >
            <i className="fas fa-plus"></i>
            <span>Create Campaign</span>
          </button>
        </div>


        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          {/* Search */}
          <div className="relative">
            <i className="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            <input
              type="text"
              placeholder="Search campaigns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="running">Running</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>

          {/* Date Filter */}
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>

          {/* Clear Filters */}
          <button
            onClick={() => {
              setSearchTerm('')
              setStatusFilter('all')
              setDateFilter('all')
              setCustomDateRange({ start: '', end: '' })
            }}
            className="px-4 py-3 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            <i className="fas fa-redo mr-2"></i>
            Clear Filters
          </button>
        </div>

        {/* Custom Date Range */}
        {dateFilter === 'custom' && (
          <div className="mt-4 flex items-center space-x-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={customDateRange.start}
                onChange={(e) => setCustomDateRange({...customDateRange, start: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={customDateRange.end}
                onChange={(e) => setCustomDateRange({...customDateRange, end: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}
      </div>

      {/* Campaigns Table */}
      <div className="flex-1 overflow-hidden p-6 flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="spinner w-12 h-12"></div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
              <div className="overflow-x-auto flex-1">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Campaign Name
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Recipients
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Progress
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Deployed
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {currentCampaigns.map((campaign) => {
                      const statusConfig = getStatusConfig(campaign.status)
                      const progress = campaign.total_recipients > 0 
                        ? Math.round((campaign.sent_count / campaign.total_recipients) * 100) 
                        : 0

                      return (
                        <tr key={campaign.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-11 h-11 bg-gradient-to-br from-[#C54A3F] to-[#B73E34] rounded-xl flex items-center justify-center text-white text-sm font-bold mr-3 shadow-md">
                                {campaign.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-gray-900">{campaign.name}</div>
                                <div className="text-xs text-gray-500">
                                  <i className="fas fa-phone mr-1"></i>
                                  {formatPhoneNumber(campaign.sender_number)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusConfig.color}`}>
                              <i className={`fas ${statusConfig.icon} mr-1.5`}></i>
                              {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              <div className="font-medium">{campaign.total_recipients} total</div>
                              <div className="text-xs text-gray-500">
                                <span className="text-green-600">{campaign.sent_count} sent</span>
                                {campaign.failed_count > 0 && (
                                  <span className="text-red-600 ml-2">{campaign.failed_count} failed</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-1 mr-3">
                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                  <div
                                    className={`h-2.5 rounded-full transition-all duration-500 ${
                                      progress === 100 ? 'bg-gradient-to-r from-green-500 to-emerald-600' : 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34]'
                                    }`}
                                    style={{ width: `${progress}%` }}
                                  ></div>
                                </div>
                              </div>
                              <span className="text-sm font-bold text-gray-900 min-w-[3rem] text-right">
                                {progress}%
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-gray-600">
                              {formatDate(campaign.created_at)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end space-x-2">
                              {campaign.status === 'draft' && (
                                <button
                                  onClick={() => startCampaign(campaign.id)}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                                  title="Start campaign"
                                >
                                  <i className="fas fa-play mr-1"></i>
                                  Start
                                </button>
                              )}
                              
                              {campaign.status === 'running' && (
                                <button
                                  onClick={() => stopCampaign(campaign.id)}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                                  title="Stop campaign"
                                >
                                  <i className="fas fa-stop mr-1"></i>
                                  Stop
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  setSelectedCampaign(campaign)
                                  setShowViewCampaign(true)
                                }}
                                className="p-2 text-[#C54A3F] hover:bg-red-50 rounded-lg transition-colors"
                                title="View details"
                              >
                                <i className="fas fa-eye"></i>
                              </button>
                              
                              <button 
                                onClick={() => setDeleteConfirm(campaign)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete campaign"
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    
                    {currentCampaigns.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-6 py-16 text-center">
                          <i className="fas fa-bullhorn text-gray-400 text-6xl mb-4"></i>
                          <p className="text-gray-500 text-lg font-medium mb-2">
                            {campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match your filters'}
                          </p>
                          <p className="text-sm text-gray-400">
                            {campaigns.length === 0 
                              ? 'Create your first campaign to start sending bulk messages'
                              : 'Try adjusting your search or filters'}
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between bg-white px-6 py-4 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <span>
                    Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                    <span className="font-semibold">{Math.min(endIndex, filteredCampaigns.length)}</span> of{' '}
                    <span className="font-semibold">{filteredCampaigns.length}</span> campaigns
                  </span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => goToPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <i className="fas fa-angles-left"></i>
                  </button>

                  <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <i className="fas fa-angle-left mr-1"></i>
                    Previous
                  </button>

                  <div className="flex items-center space-x-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(page => {
                        return (
                          page === 1 ||
                          page === totalPages ||
                          (page >= currentPage - 1 && page <= currentPage + 1)
                        )
                      })
                      .map((page, index, array) => (
                        <div key={page} className="flex items-center">
                          {index > 0 && array[index - 1] !== page - 1 && (
                            <span className="px-2 text-gray-400">...</span>
                          )}
                          <button
                            onClick={() => goToPage(page)}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                              currentPage === page
                                ? 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white shadow-md'
                                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        </div>
                      ))}
                  </div>

                  <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <i className="fas fa-angle-right ml-1"></i>
                  </button>

                  <button
                    onClick={() => goToPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <i className="fas fa-angles-right"></i>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showCreateCampaign && (
        <CreateCampaignModal
          onClose={() => setShowCreateCampaign(false)}
          contactLists={contactLists}
          phoneNumbers={phoneNumbers}
          onCampaignCreated={fetchCampaigns}
          formatPhoneNumber={formatPhoneNumber}
          onError={(error) => setErrorModal(error)}
        />
      )}

      {showViewCampaign && selectedCampaign && (
        <ViewCampaignModal
          campaign={selectedCampaign}
          onClose={() => {
            setShowViewCampaign(false)
            setSelectedCampaign(null)
          }}
          formatPhoneNumber={formatPhoneNumber}
          formatDate={formatDate}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          campaign={deleteConfirm}
          onConfirm={() => deleteCampaign(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {errorModal && (
        <ErrorModal
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
      )}
    </div>
  )
}

// Error Modal Component
function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-[80] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-circle text-red-600 text-2xl"></i>
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">{title}</h3>
          <p className="text-sm text-gray-600 text-center mb-6">{message}</p>

          <button
            onClick={onClose}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-colors shadow-md"
          >
            <i className="fas fa-check mr-2"></i>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// Delete Confirm Modal
function DeleteConfirmModal({ campaign, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">Delete Campaign?</h3>
          <p className="text-sm text-gray-600 text-center mb-6">
            Are you sure you want to delete <span className="font-semibold">{campaign.name}</span>? This action cannot be undone.
          </p>

          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
            >
              <i className="fas fa-times mr-2"></i>
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Deleting...
                </>
              ) : (
                <>
                  <i className="fas fa-trash mr-2"></i>
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// View Campaign Modal
function ViewCampaignModal({ campaign, onClose, formatPhoneNumber, formatDate }) {
  const progress = campaign.total_recipients > 0 
    ? Math.round((campaign.sent_count / campaign.total_recipients) * 100) 
    : 0

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{campaign.name}</h3>
            <p className="text-sm text-gray-500 mt-1">Campaign Details</p>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">
                <i className="fas fa-users mr-1"></i>
                Total Recipients
              </p>
              <p className="text-2xl font-bold text-gray-900">{campaign.total_recipients}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-4">
              <p className="text-xs text-green-600 mb-1">
                <i className="fas fa-check-circle mr-1"></i>
                Sent
              </p>
              <p className="text-2xl font-bold text-green-700">{campaign.sent_count}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4">
              <p className="text-xs text-red-600 mb-1">
                <i className="fas fa-times-circle mr-1"></i>
                Failed
              </p>
              <p className="text-2xl font-bold text-red-700">{campaign.failed_count}</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-xs text-blue-600 mb-1">
                <i className="fas fa-chart-line mr-1"></i>
                Progress
              </p>
              <p className="text-2xl font-bold text-blue-700">{progress}%</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Campaign Progress</span>
              <span className="text-sm font-bold text-gray-900">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${
                  progress === 100 ? 'bg-gradient-to-r from-green-500 to-emerald-600' : 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34]'
                }`}
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          {/* Campaign Details */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-bold text-gray-900 mb-3">
              <i className="fas fa-info-circle mr-2 text-[#C54A3F]"></i>
              Campaign Information
            </h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <p className="text-sm font-medium text-gray-900 capitalize">{campaign.status}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Sender Number</p>
                <p className="text-sm font-medium text-gray-900">{formatPhoneNumber(campaign.sender_number)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Created</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(campaign.created_at)}</p>
              </div>
              {campaign.started_at && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Started</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(campaign.started_at)}</p>
                </div>
              )}
              {campaign.completed_at && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Completed</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(campaign.completed_at)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 mb-1">Delay Between Messages</p>
                <p className="text-sm font-medium text-gray-900">{campaign.delay_between_messages}ms</p>
              </div>
            </div>
          </div>

          {/* Message Template */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h4 className="text-sm font-bold text-gray-900 mb-3">
              <i className="fas fa-comment-alt mr-2 text-[#C54A3F]"></i>
              Message Template
            </h4>
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{campaign.message_template}</p>
            </div>
          </div>

          {/* Contact Lists */}
          {campaign.contact_list_ids && campaign.contact_list_ids.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4">
              <h4 className="text-sm font-bold text-gray-900 mb-3">
                <i className="fas fa-list mr-2 text-[#C54A3F]"></i>
                Targeted Contact Lists
              </h4>
              <div className="space-y-2">
                {campaign.contact_list_ids.map((listId, index) => (
                  <div key={listId} className="bg-white rounded-lg p-3 border border-gray-200 flex items-center shadow-sm">
                    <div className="w-8 h-8 bg-gradient-to-br from-[#C54A3F] to-[#B73E34] rounded-lg flex items-center justify-center text-white text-xs font-bold mr-3 shadow-md">
                      {index + 1}
                    </div>
                    <span className="text-sm text-gray-900">Contact List #{listId.slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Create Campaign Modal
function CreateCampaignModal({ onClose, contactLists, phoneNumbers, onCampaignCreated, formatPhoneNumber, onError }) {
  const [formData, setFormData] = useState({
    name: '',
    message_template: '',
    sender_number: '',
    contact_list_ids: [],
    delay_between_messages: 1000
  })
  const [loading, setLoading] = useState(false)
  const [availableTags, setAvailableTags] = useState([])
  const [templates, setTemplates] = useState([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  useEffect(() => {
    const fetchTags = async () => {
      if (formData.contact_list_ids.length === 0) {
        setAvailableTags([])
        return
      }

      try {
        const response = await apiGet(`/api/contacts/tags?lists=${formData.contact_list_ids.join(',')}`)
        const data = await response.json()
        if (data.success) {
          setAvailableTags(data.tags)
        }
      } catch (error) {
        console.error('Error fetching tags:', error)
      }
    }

    fetchTags()
  }, [formData.contact_list_ids])

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await apiGet('/api/message-templates')
        const data = await response.json()
        if (data.success) {
          setTemplates(data.templates)
        }
      } catch (error) {
        console.error('Error fetching templates:', error)
      }
    }

    fetchTemplates()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await apiPost('/api/campaigns', formData)

      const data = await response.json()

      if (data.success) {
        onCampaignCreated()
        onClose()
      } else {
        onClose()
        onError({
          title: 'Failed to Create Campaign',
          message: data.error || 'An error occurred while creating the campaign.'
        })
      }
    } catch (error) {
      console.error('Error creating campaign:', error)
      onClose()
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  const insertTag = (tag) => {
    const textarea = document.getElementById('message-template')
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = formData.message_template
    const before = text.substring(0, start)
    const after = text.substring(end, text.length)

    setFormData({
      ...formData,
      message_template: before + `{${tag}}` + after
    })

    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + tag.length + 2, start + tag.length + 2)
    }, 0)
  }

  const loadTemplate = (template) => {
    setFormData({
      ...formData,
      message_template: template.message_template
    })
  }

  const saveAsTemplate = async () => {
    if (!newTemplateName.trim() || !formData.message_template.trim()) {
      return
    }

    try {
      const response = await apiPost('/api/message-templates', {
        name: newTemplateName.trim(),
        message_template: formData.message_template.trim()
      })

      const data = await response.json()

      if (data.success) {
        setTemplates([...templates, data.template])
        setShowTemplateModal(false)
        setNewTemplateName('')
      } else {
        onError({
          title: 'Failed to Save Template',
          message: data.error || 'An error occurred while saving the template.'
        })
      }
    } catch (error) {
      console.error('Error saving template:', error)
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const toggleContactList = (listId) => {
    const isAdding = !formData.contact_list_ids.includes(listId)
    const newContactListIds = isAdding
      ? [...formData.contact_list_ids, listId]
      : formData.contact_list_ids.filter(id => id !== listId)

    // Auto-fill campaign name with first selected contact list name
    let newName = formData.name
    if (isAdding && formData.contact_list_ids.length === 0) {
      const selectedList = contactLists.find(list => list.id === listId)
      if (selectedList) {
        newName = selectedList.name
      }
    }

    setFormData({
      ...formData,
      name: newName,
      contact_list_ids: newContactListIds
    })
  }

  const totalRecipients = contactLists
    .filter(list => formData.contact_list_ids.includes(list.id))
    .reduce((total, list) => total + (list.contactCount || 0), 0)

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slideUp">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h3 className="text-xl font-bold text-gray-900">
            <i className="fas fa-bullhorn mr-2 text-[#C54A3F]"></i>
            Create Campaign
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-tag mr-1"></i>
              Campaign Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="e.g., Marketing Campaign - August 2024"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-phone mr-1"></i>
              Send From *
            </label>
            <select
              required
              value={formData.sender_number}
              onChange={(e) => setFormData({...formData, sender_number: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="">Select phone number</option>
              {phoneNumbers.map(phone => (
                <option key={phone.id} value={phone.phoneNumber}>
                  {phone.custom_name ? `${phone.custom_name} - ${formatPhoneNumber(phone.phoneNumber)}` : formatPhoneNumber(phone.phoneNumber)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-users mr-1"></i>
              Contact Lists *
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-300 rounded-xl p-4 bg-gray-50">
              {contactLists.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No contact lists available</p>
              ) : (
                contactLists.map(list => (
                  <label key={list.id} className="flex items-center p-2 hover:bg-white rounded-lg transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary mr-3"
                      checked={formData.contact_list_ids.includes(list.id)}
                      onChange={() => toggleContactList(list.id)}
                    />
                    <span className="text-sm font-medium text-gray-900 flex-1">{list.name}</span>
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">
                      <i className="fas fa-users mr-1"></i>
                      {list.contactCount || 0}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>


<div>
  <div className="flex items-center justify-between mb-2">
    <label className="block text-sm font-semibold text-gray-700">
      <i className="fas fa-comment-alt mr-1"></i>
      Message Template *
    </label>
    <div className="flex items-center space-x-2">
      {templates.length > 0 && (
        <select
          onChange={(e) => {
            if (e.target.value) {
              const template = templates.find(t => t.id === e.target.value)
              if (template) loadTemplate(template)
            }
          }}
          className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Load Template</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => setShowTemplateModal(true)}
        disabled={!formData.message_template.trim()}
        className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
      >
        <i className="fas fa-save mr-1"></i>
        Save as Template
      </button>
    </div>
  </div>
  <textarea
    id="message-template"
    required
    value={formData.message_template}
    onChange={(e) => setFormData({...formData, message_template: e.target.value})}
    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
    rows={5}
    placeholder="Hi {business_name}, this is a message from our business..."
    maxLength={1600}
  />
  <div className="flex justify-between items-center mt-2">
    <p className="text-xs text-gray-500">
      <i className="fas fa-info-circle mr-1"></i>
      Use {'{'}tags{'}'} to personalize messages
    </p>
    <p className={`text-xs font-medium ${formData.message_template.length > 1500 ? 'text-red-600' : 'text-gray-500'}`}>
      {formData.message_template.length}/1600
    </p>
  </div>
  
  {availableTags.length > 0 && (
    <div className="mt-3 p-4 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-[#C54A3F]/20 rounded-xl shadow-sm">
      <p className="text-sm font-bold text-gray-900 mb-3 flex items-center">
        <i className="fas fa-tags mr-2 text-[#C54A3F]"></i>
        Available Placeholder Tags
      </p>
      <p className="text-xs text-gray-600 mb-3">
        Click any tag to insert it into your message template. Tags will be replaced with actual contact data when sending.
      </p>
      <div className="flex flex-wrap gap-2">
        {availableTags.map(tag => (
          <button
            key={tag}
            type="button"
            onClick={() => insertTag(tag)}
            className="inline-flex items-center px-4 py-2 text-xs font-semibold bg-white text-[#C54A3F] border-2 border-[#C54A3F]/30 rounded-lg hover:bg-[#C54A3F] hover:text-white hover:border-[#C54A3F] transition-all shadow-sm hover:shadow-md"
          >
            <i className="fas fa-plus-circle mr-1.5"></i>
            {'{'}{ tag}{'}'}
          </button>
        ))}
      </div>
    </div>
  )}
</div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-clock mr-1"></i>
              Delay Between Messages (milliseconds)
            </label>
            <input
              type="number"
              min="100"
              max="60000"
              value={formData.delay_between_messages}
              onChange={(e) => setFormData({...formData, delay_between_messages: parseInt(e.target.value)})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-2">
              <i className="fas fa-lightbulb mr-1"></i>
              Recommended: 1000ms (1 second) to avoid rate limits
            </p>
          </div>

          {totalRecipients > 0 && (
            <div className="bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 border-2 border-[#C54A3F]/20 rounded-xl p-5 shadow-md">
              <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center">
                <i className="fas fa-chart-pie mr-2 text-[#C54A3F]"></i>
                Campaign Summary
              </h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <p className="text-gray-600 text-xs mb-1">Selected Lists</p>
                  <p className="font-bold text-gray-900 text-lg">{formData.contact_list_ids.length}</p>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
                  <p className="text-gray-600 text-xs mb-1">Total Recipients</p>
                  <p className="font-bold text-[#C54A3F] text-lg">{totalRecipients}</p>
                </div>
                <div className="bg-white rounded-lg p-3 col-span-2 shadow-sm border border-gray-200">
                  <p className="text-gray-600 text-xs mb-1">Estimated Duration</p>
                  <p className="font-bold text-gray-900 text-lg">
                    <i className="fas fa-hourglass-half mr-2 text-amber-500"></i>
                    ~{Math.ceil((totalRecipients * formData.delay_between_messages) / 1000 / 60)} minutes
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || totalRecipients === 0}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-all shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Creating...
                </>
              ) : (
                <>
                  <i className="fas fa-paper-plane mr-2"></i>
                  Create Campaign
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Save as Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                <i className="fas fa-save mr-2 text-[#C54A3F]"></i>
                Save as Template
              </h3>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="Enter template name"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary mb-4"
                autoFocus
              />
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowTemplateModal(false)
                    setNewTemplateName('')
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAsTemplate}
                  disabled={!newTemplateName.trim()}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white rounded-lg font-semibold hover:from-[#B73E34] hover:to-[#A53329] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="fas fa-check mr-2"></i>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}