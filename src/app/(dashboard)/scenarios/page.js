'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [selectedScenario, setSelectedScenario] = useState(null)
  const [showFollowupModal, setShowFollowupModal] = useState(false)
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false)
  const [showExecutionsModal, setShowExecutionsModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [errorModal, setErrorModal] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const fetchScenarios = useCallback(async () => {
    try {
      const response = await apiGet('/api/scenarios')
      const data = await response.json()
      if (data.success) setScenarios(data.scenarios || [])
    } catch (error) {
      console.error('Error fetching scenarios:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [phoneRes] = await Promise.all([
          apiGet('/api/phone-numbers'),
        ])
        const phoneData = await phoneRes.json()
        if (phoneData.success) setPhoneNumbers(phoneData.phoneNumbers || [])
      } catch (error) {
        console.error('Error fetching data:', error)
      }
    }
    fetchScenarios()
    fetchData()
  }, [fetchScenarios])

  const handleDeleteScenario = async (scenarioId) => {
    try {
      const response = await fetchWithWorkspace(`/api/scenarios/${scenarioId}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setDeleteConfirm(null)
        setSelectedScenario(null)
        setShowViewModal(false)
        await fetchScenarios()
      } else {
        setErrorModal({ title: 'Error', message: data.error || 'Failed to delete scenario' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to delete scenario. Please try again.' })
    }
  }

  const handleToggleActive = async (scenario) => {
    try {
      const response = await fetchWithWorkspace(`/api/scenarios/${scenario.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !scenario.is_active }),
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await response.json()
      if (data.success) {
        await fetchScenarios()
      } else {
        setErrorModal({ title: 'Error', message: data.error || 'Failed to update scenario' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'Failed to update scenario. Please try again.' })
    }
  }

  const filteredScenarios = useMemo(() => {
    return scenarios.filter((scenario) => {
      const searchLower = searchTerm.toLowerCase()
      const matchesSearch =
        scenario.name.toLowerCase().includes(searchLower) ||
        (scenario.description || '').toLowerCase().includes(searchLower)
      if (!matchesSearch) return false
      if (statusFilter === 'active' && !scenario.is_active) return false
      if (statusFilter === 'inactive' && scenario.is_active) return false
      return true
    })
  }, [scenarios, searchTerm, statusFilter])

  const paginatedScenarios = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredScenarios.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredScenarios, currentPage])

  const totalPages = Math.ceil(filteredScenarios.length / itemsPerPage)

  useEffect(() => { setCurrentPage(1) }, [searchTerm, statusFilter])

  if (loading) {
    return (
      <div className="h-full bg-[#F7F6F3] flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin text-2xl text-[#9B9890] mb-3"></i>
          <p className="text-sm text-[#9B9890]">Loading scenarios…</p>
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
              <h3 className="text-sm font-semibold text-[#131210] flex-shrink-0">AI Scenarios</h3>
              <div className="relative flex-1 max-w-xs">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                <input
                  type="text"
                  placeholder="Search scenarios…"
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
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors flex-shrink-0"
            >
              <i className="fas fa-plus text-xs"></i>
              New Scenario
            </button>
          </div>

          {/* Table */}
          {paginatedScenarios.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-[#9B9890]">No scenarios found</p>
              <p className="text-xs text-[#9B9890] mt-1">
                {scenarios.length === 0 ? 'Create your first AI scenario to get started' : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Scenario</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Phone Numbers</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Follow-ups</th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E1DB]">
                    {paginatedScenarios.map((scenario) => (
                      <tr
                        key={scenario.id}
                        className="hover:bg-[#F7F6F3] cursor-pointer"
                        onClick={() => { setSelectedScenario(scenario); setShowViewModal(true) }}
                      >
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-[#131210]">{scenario.name}</p>
                          <p className="text-xs text-[#9B9890] truncate max-w-xs mt-0.5">{scenario.description || scenario.instructions?.slice(0, 60) + '…'}</p>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            scenario.is_active ? 'bg-green-50 text-green-700' : 'bg-[#EFEDE8] text-[#5C5A55]'
                          }`}>
                            {scenario.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-[#5C5A55]">
                          {scenario.scenario_phone_numbers?.length > 0
                            ? scenario.scenario_phone_numbers.map(spn => spn.phone_numbers?.phone_number || spn.phone_number_id).join(', ')
                            : <span className="text-[#9B9890] text-xs">None assigned</span>
                          }
                        </td>
                        <td className="px-5 py-3">
                          {scenario.enable_followups ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(214,59,31,0.07)] text-[#D63B1F]">
                              <i className="fas fa-robot text-[10px]"></i>
                              Enabled
                            </span>
                          ) : (
                            <span className="text-xs text-[#9B9890]">Disabled</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              title="View"
                              onClick={(e) => { e.stopPropagation(); setSelectedScenario(scenario); setShowViewModal(true) }}
                              className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"
                            >
                              <i className="fas fa-eye text-[13px]"></i>
                            </button>
                            <button
                              title="Execution Logs"
                              onClick={(e) => { e.stopPropagation(); setSelectedScenario(scenario); setShowExecutionsModal(true) }}
                              className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"
                            >
                              <i className="fas fa-list-alt text-[13px]"></i>
                            </button>
                            <button
                              title="Follow-up Stages"
                              onClick={(e) => { e.stopPropagation(); setSelectedScenario(scenario); setShowFollowupModal(true) }}
                              className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"
                            >
                              <i className="fas fa-layer-group text-[13px]"></i>
                            </button>
                            <button
                              title="Analytics"
                              onClick={(e) => { e.stopPropagation(); setSelectedScenario(scenario); setShowAnalyticsModal(true) }}
                              className="p-1.5 text-[#9B9890] hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                            >
                              <i className="fas fa-chart-bar text-[13px]"></i>
                            </button>
                            <button
                              title={scenario.is_active ? 'Deactivate' : 'Activate'}
                              onClick={(e) => { e.stopPropagation(); handleToggleActive(scenario) }}
                              className={`p-1.5 rounded transition-colors ${scenario.is_active ? 'text-[#9B9890] hover:text-yellow-600 hover:bg-yellow-50' : 'text-[#9B9890] hover:text-green-600 hover:bg-green-50'}`}
                            >
                              <i className={`fas ${scenario.is_active ? 'fa-pause' : 'fa-play'} text-[13px]`}></i>
                            </button>
                            <button
                              title="Delete"
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ scenarioId: scenario.id, scenarioName: scenario.name }) }}
                              className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"
                            >
                              <i className="fas fa-trash text-[13px]"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
                  <p className="text-xs text-[#9B9890]">
                    {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredScenarios.length)} of {filteredScenarios.length}
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

      {showCreateModal && (
        <CreateScenarioModal
          phoneNumbers={phoneNumbers}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => { setShowCreateModal(false); fetchScenarios() }}
        />
      )}

      {showViewModal && selectedScenario && (
        <ViewScenarioModal
          scenario={selectedScenario}
          phoneNumbers={phoneNumbers}
          onClose={() => { setShowViewModal(false); setSelectedScenario(null) }}
          onUpdated={() => fetchScenarios()}
          onToggleActive={() => handleToggleActive(selectedScenario)}
          onDelete={() => setDeleteConfirm({ scenarioId: selectedScenario.id, scenarioName: selectedScenario.name })}
          onFollowups={() => { setShowViewModal(false); setShowFollowupModal(true) }}
          onAnalytics={() => { setShowViewModal(false); setShowAnalyticsModal(true) }}
          onExecutions={() => { setShowViewModal(false); setShowExecutionsModal(true) }}
        />
      )}

      {showFollowupModal && selectedScenario && (
        <FollowupStagesModal
          scenario={selectedScenario}
          onClose={() => { setShowFollowupModal(false); setSelectedScenario(null) }}
          onSuccess={() => fetchScenarios()}
        />
      )}

      {showAnalyticsModal && selectedScenario && (
        <AnalyticsModal
          scenario={selectedScenario}
          onClose={() => { setShowAnalyticsModal(false); setSelectedScenario(null) }}
        />
      )}

      {showExecutionsModal && selectedScenario && (
        <ExecutionsModal
          scenario={selectedScenario}
          onClose={() => { setShowExecutionsModal(false); setSelectedScenario(null) }}
        />
      )}

      {errorModal && (
        <ErrorModal title={errorModal.title} message={errorModal.message} onClose={() => setErrorModal(null)} />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          scenarioName={deleteConfirm.scenarioName}
          onConfirm={() => handleDeleteScenario(deleteConfirm.scenarioId)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}

// ─── Create Scenario Modal ───────────────────────────────────────────────────

function CreateScenarioModal({ phoneNumbers, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    instructions: '',
    phoneNumbers: [],
    contact_list_ids: [],
    enable_followups: false,
    max_followup_attempts: 3,
    enable_business_hours: false,
    business_hours_start: '09:00',
    business_hours_end: '18:00',
    business_hours_timezone: 'America/New_York',
    auto_stop_keywords: 'STOP,UNSUBSCRIBE,CANCEL',
  })
  const [contactLists, setContactLists] = useState([])
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [created, setCreated] = useState(false)

  useEffect(() => {
    apiGet('/api/contact-lists').then(r => r.json()).then(d => {
      setContactLists(d.contactLists || [])
    }).catch(() => {})
  }, [])

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Scenario name is required'
    if (!formData.instructions.trim()) newErrors.instructions = 'Instructions are required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return
    setIsSubmitting(true)
    try {
      const keywords = formData.auto_stop_keywords
        .split(',')
        .map(k => k.trim().toUpperCase())
        .filter(Boolean)

      const response = await apiPost('/api/scenarios', {
        name: formData.name,
        description: formData.description || null,
        instructions: formData.instructions,
        phoneNumbers: formData.phoneNumbers,
        contact_list_ids: formData.contact_list_ids,
        enable_followups: formData.enable_followups,
        max_followup_attempts: formData.max_followup_attempts,
        enable_business_hours: formData.enable_business_hours,
        business_hours_start: formData.business_hours_start + ':00',
        business_hours_end: formData.business_hours_end + ':00',
        business_hours_timezone: formData.business_hours_timezone,
        auto_stop_keywords: keywords,
      })
      const data = await response.json()
      if (data.success) {
        setCreated(true)
      } else {
        setErrors({ submit: data.error || 'Failed to create scenario' })
      }
    } catch {
      setErrors({ submit: 'Failed to create scenario. Please try again.' })
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
            <h3 className="text-sm font-semibold text-[#131210] mb-1">Scenario Created</h3>
            <p className="text-xs text-[#9B9890] mb-4">Your AI scenario has been created successfully.</p>
            <button onClick={onSuccess} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF] z-10">
          <h3 className="text-sm font-semibold text-[#131210]">New Scenario</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Scenario Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Real Estate Lead Follow-up"
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              />
              {errors.name && <p className="text-[#D63B1F] text-xs mt-1">{errors.name}</p>}
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description (optional)"
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">AI Instructions *</label>
              <textarea
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                placeholder="You are a helpful assistant for XYZ company. When a customer messages, respond professionally and…"
                rows="5"
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none"
              />
              {errors.instructions && <p className="text-[#D63B1F] text-xs mt-1">{errors.instructions}</p>}
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Assign Phone Numbers</label>
              <div className="space-y-1.5 max-h-28 overflow-y-auto border border-[#E3E1DB] rounded-md p-2">
                {phoneNumbers.length === 0 ? (
                  <p className="text-xs text-[#9B9890] py-1">No phone numbers available</p>
                ) : phoneNumbers.map((pn) => (
                  <label key={pn.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.phoneNumbers.includes(pn.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, phoneNumbers: [...formData.phoneNumbers, pn.id] })
                        } else {
                          setFormData({ ...formData, phoneNumbers: formData.phoneNumbers.filter(id => id !== pn.id) })
                        }
                      }}
                      className="text-[#D63B1F]"
                    />
                    <span className="text-sm text-[#5C5A55]">{pn.custom_name || pn.phoneNumber}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#5C5A55] mb-1">Contact Restrictions</label>
              <p className="text-[11px] text-[#9B9890] mb-1.5">Restrict this scenario to contacts in specific lists. Leave empty to apply to all incoming contacts.</p>
              <div className="space-y-1.5 max-h-28 overflow-y-auto border border-[#E3E1DB] rounded-md p-2">
                {contactLists.length === 0 ? (
                  <p className="text-xs text-[#9B9890] py-1">No contact lists found</p>
                ) : contactLists.map((cl) => (
                  <label key={cl.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.contact_list_ids.includes(cl.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({ ...formData, contact_list_ids: [...formData.contact_list_ids, cl.id] })
                        } else {
                          setFormData({ ...formData, contact_list_ids: formData.contact_list_ids.filter(id => id !== cl.id) })
                        }
                      }}
                      className="text-[#D63B1F]"
                    />
                    <span className="text-sm text-[#5C5A55]">{cl.name}</span>
                    {cl.contactCount !== undefined && (
                      <span className="text-xs text-[#9B9890]">({cl.contactCount} contacts)</span>
                    )}
                  </label>
                ))}
              </div>
              {formData.contact_list_ids.length > 0 && (
                <p className="text-[11px] text-[#D63B1F] mt-1.5">
                  <i className="fas fa-filter mr-1"></i>
                  Restricted to {formData.contact_list_ids.length} list{formData.contact_list_ids.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Follow-up Settings */}
          <div className="border border-[#E3E1DB] rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#5C5A55]">Automatic Follow-ups</p>
                <p className="text-[11px] text-[#9B9890] mt-0.5">Send follow-up messages if no response</p>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, enable_followups: !formData.enable_followups })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${formData.enable_followups ? 'bg-[#D63B1F]' : 'bg-[#EFEDE8]'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#FFFFFF] shadow ring-0 transition duration-200 ease-in-out ${formData.enable_followups ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            {formData.enable_followups && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Max Follow-up Attempts</label>
                  <select
                    value={formData.max_followup_attempts}
                    onChange={(e) => setFormData({ ...formData, max_followup_attempts: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Stop Keywords</label>
                  <input
                    type="text"
                    value={formData.auto_stop_keywords}
                    onChange={(e) => setFormData({ ...formData, auto_stop_keywords: e.target.value })}
                    placeholder="STOP,UNSUBSCRIBE"
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Business Hours */}
          <div className="border border-[#E3E1DB] rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#5C5A55]">Business Hours Restriction</p>
                <p className="text-[11px] text-[#9B9890] mt-0.5">Only respond during business hours</p>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, enable_business_hours: !formData.enable_business_hours })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${formData.enable_business_hours ? 'bg-[#D63B1F]' : 'bg-[#EFEDE8]'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#FFFFFF] shadow ring-0 transition duration-200 ease-in-out ${formData.enable_business_hours ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            {formData.enable_business_hours && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Start Time</label>
                  <input
                    type="time"
                    value={formData.business_hours_start}
                    onChange={(e) => setFormData({ ...formData, business_hours_start: e.target.value })}
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">End Time</label>
                  <input
                    type="time"
                    value={formData.business_hours_end}
                    onChange={(e) => setFormData({ ...formData, business_hours_end: e.target.value })}
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Timezone</label>
                  <select
                    value={formData.business_hours_timezone}
                    onChange={(e) => setFormData({ ...formData, business_hours_timezone: e.target.value })}
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                  >
                    <option value="America/New_York">Eastern (ET)</option>
                    <option value="America/Chicago">Central (CT)</option>
                    <option value="America/Denver">Mountain (MT)</option>
                    <option value="America/Los_Angeles">Pacific (PT)</option>
                    <option value="America/Phoenix">Arizona (MST)</option>
                    <option value="America/Anchorage">Alaska (AKT)</option>
                    <option value="Pacific/Honolulu">Hawaii (HST)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {errors.submit && (
            <div className="bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] text-[#D63B1F] px-3 py-2.5 rounded-md text-sm">
              {errors.submit}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
            <button
              type="submit" disabled={isSubmitting}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50"
            >
              {isSubmitting ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Creating…</> : 'Create Scenario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── View / Edit Scenario Modal ──────────────────────────────────────────────

function ViewScenarioModal({ scenario, phoneNumbers, onClose, onUpdated, onToggleActive, onDelete, onFollowups, onAnalytics, onExecutions }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editData, setEditData] = useState({
    name: scenario.name,
    description: scenario.description || '',
    instructions: scenario.instructions || '',
    phoneNumbers: scenario.scenario_phone_numbers?.map(spn => spn.phone_number_id) || [],
    contact_list_ids: scenario.restrict_to_contact_lists || [],
    enable_followups: scenario.enable_followups || false,
    max_followup_attempts: scenario.max_followup_attempts || 3,
    enable_business_hours: scenario.enable_business_hours || false,
    business_hours_start: (scenario.business_hours_start || '09:00:00').slice(0, 5),
    business_hours_end: (scenario.business_hours_end || '18:00:00').slice(0, 5),
    business_hours_timezone: scenario.business_hours_timezone || 'America/New_York',
    auto_stop_keywords: (scenario.auto_stop_keywords || ['STOP', 'UNSUBSCRIBE']).join(','),
  })
  const [contactLists, setContactLists] = useState([])
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    apiGet('/api/contact-lists').then(r => r.json()).then(d => {
      setContactLists(d.contactLists || [])
    }).catch(() => {})
  }, [])

  const handleEditSubmit = async (e) => {
    e.preventDefault()
    if (!editData.name.trim()) { setErrors({ name: 'Name is required' }); return }
    if (!editData.instructions.trim()) { setErrors({ instructions: 'Instructions are required' }); return }
    setIsSubmitting(true)
    try {
      const keywords = editData.auto_stop_keywords
        .split(',')
        .map(k => k.trim().toUpperCase())
        .filter(Boolean)

      const response = await fetchWithWorkspace(`/api/scenarios/${scenario.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editData.name,
          description: editData.description || null,
          instructions: editData.instructions,
          phoneNumbers: editData.phoneNumbers,
          contact_list_ids: editData.contact_list_ids,
          enable_followups: editData.enable_followups,
          max_followup_attempts: editData.max_followup_attempts,
          enable_business_hours: editData.enable_business_hours,
          business_hours_start: editData.business_hours_start + ':00',
          business_hours_end: editData.business_hours_end + ':00',
          business_hours_timezone: editData.business_hours_timezone,
          auto_stop_keywords: keywords,
        }),
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await response.json()
      if (data.success) {
        setIsEditing(false)
        onUpdated()
      } else {
        setErrors({ submit: data.error || 'Failed to update scenario' })
      }
    } catch {
      setErrors({ submit: 'Failed to update scenario. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF] z-10">
          <h3 className="text-sm font-semibold text-[#131210]">{isEditing ? 'Edit Scenario' : 'Scenario Details'}</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Scenario Name *</label>
              <input
                type="text"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              />
              {errors.name && <p className="text-[#D63B1F] text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Description</label>
              <input
                type="text"
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">AI Instructions *</label>
              <textarea
                value={editData.instructions}
                onChange={(e) => setEditData({ ...editData, instructions: e.target.value })}
                rows="5"
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none"
              />
              {errors.instructions && <p className="text-[#D63B1F] text-xs mt-1">{errors.instructions}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Assign Phone Numbers</label>
              <div className="space-y-1.5 max-h-28 overflow-y-auto border border-[#E3E1DB] rounded-md p-2">
                {phoneNumbers.map((pn) => (
                  <label key={pn.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editData.phoneNumbers.includes(pn.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditData({ ...editData, phoneNumbers: [...editData.phoneNumbers, pn.id] })
                        } else {
                          setEditData({ ...editData, phoneNumbers: editData.phoneNumbers.filter(id => id !== pn.id) })
                        }
                      }}
                      className="text-[#D63B1F]"
                    />
                    <span className="text-sm text-[#5C5A55]">{pn.custom_name || pn.phoneNumber}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1">Contact Restrictions</label>
              <p className="text-[11px] text-[#9B9890] mb-1.5">Restrict to contacts in specific lists. Leave empty to apply to all.</p>
              <div className="space-y-1.5 max-h-28 overflow-y-auto border border-[#E3E1DB] rounded-md p-2">
                {contactLists.length === 0 ? (
                  <p className="text-xs text-[#9B9890] py-1">No contact lists found</p>
                ) : contactLists.map((cl) => (
                  <label key={cl.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editData.contact_list_ids.includes(cl.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditData({ ...editData, contact_list_ids: [...editData.contact_list_ids, cl.id] })
                        } else {
                          setEditData({ ...editData, contact_list_ids: editData.contact_list_ids.filter(id => id !== cl.id) })
                        }
                      }}
                      className="text-[#D63B1F]"
                    />
                    <span className="text-sm text-[#5C5A55]">{cl.name}</span>
                    {cl.contactCount !== undefined && (
                      <span className="text-xs text-[#9B9890]">({cl.contactCount} contacts)</span>
                    )}
                  </label>
                ))}
              </div>
              {editData.contact_list_ids.length > 0 && (
                <p className="text-[11px] text-[#D63B1F] mt-1.5">
                  <i className="fas fa-filter mr-1"></i>
                  Restricted to {editData.contact_list_ids.length} list{editData.contact_list_ids.length > 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Follow-up Settings */}
            <div className="border border-[#E3E1DB] rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-[#5C5A55]">Automatic Follow-ups</p>
                  <p className="text-[11px] text-[#9B9890] mt-0.5">Send follow-up messages if no response</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditData({ ...editData, enable_followups: !editData.enable_followups })}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${editData.enable_followups ? 'bg-[#D63B1F]' : 'bg-[#EFEDE8]'}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#FFFFFF] shadow ring-0 transition duration-200 ease-in-out ${editData.enable_followups ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {editData.enable_followups && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Max Attempts</label>
                    <select
                      value={editData.max_followup_attempts}
                      onChange={(e) => setEditData({ ...editData, max_followup_attempts: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                    >
                      {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Stop Keywords</label>
                    <input
                      type="text"
                      value={editData.auto_stop_keywords}
                      onChange={(e) => setEditData({ ...editData, auto_stop_keywords: e.target.value })}
                      className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Business Hours */}
            <div className="border border-[#E3E1DB] rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-[#5C5A55]">Business Hours</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditData({ ...editData, enable_business_hours: !editData.enable_business_hours })}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${editData.enable_business_hours ? 'bg-[#D63B1F]' : 'bg-[#EFEDE8]'}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#FFFFFF] shadow ring-0 transition duration-200 ease-in-out ${editData.enable_business_hours ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {editData.enable_business_hours && (
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Start</label>
                    <input type="time" value={editData.business_hours_start} onChange={(e) => setEditData({ ...editData, business_hours_start: e.target.value })} className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">End</label>
                    <input type="time" value={editData.business_hours_end} onChange={(e) => setEditData({ ...editData, business_hours_end: e.target.value })} className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Timezone</label>
                    <select value={editData.business_hours_timezone} onChange={(e) => setEditData({ ...editData, business_hours_timezone: e.target.value })} className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]">
                      <option value="America/New_York">Eastern (ET)</option>
                      <option value="America/Chicago">Central (CT)</option>
                      <option value="America/Denver">Mountain (MT)</option>
                      <option value="America/Los_Angeles">Pacific (PT)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                </div>
              )}
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
                <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Name</p>
                <p className="text-sm font-medium text-[#131210]">{scenario.name}</p>
              </div>
              {scenario.description && (
                <div>
                  <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Description</p>
                  <p className="text-sm text-[#5C5A55]">{scenario.description}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">AI Instructions</p>
                <p className="text-sm text-[#5C5A55] bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 whitespace-pre-wrap max-h-32 overflow-y-auto">{scenario.instructions}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Status</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${scenario.is_active ? 'bg-green-50 text-green-700' : 'bg-[#EFEDE8] text-[#5C5A55]'}`}>
                    {scenario.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Follow-ups</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${scenario.enable_followups ? 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' : 'bg-[#EFEDE8] text-[#9B9890]'}`}>
                    {scenario.enable_followups ? `Enabled (max ${scenario.max_followup_attempts})` : 'Disabled'}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Phone Numbers</p>
                  <p className="text-sm text-[#5C5A55]">
                    {scenario.scenario_phone_numbers?.length > 0
                      ? scenario.scenario_phone_numbers.map(spn => spn.phone_numbers?.phone_number).join(', ')
                      : 'None assigned'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Business Hours</p>
                  <p className="text-sm text-[#5C5A55]">
                    {scenario.enable_business_hours
                      ? `${scenario.business_hours_start?.slice(0, 5)} – ${scenario.business_hours_end?.slice(0, 5)}`
                      : 'Not restricted'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-[#9B9890] uppercase tracking-wider mb-1">Contact Restrictions</p>
                  {scenario.restrict_to_contact_lists?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {scenario.restrict_to_contact_lists.map(id => {
                        const list = contactLists.find(cl => cl.id === id)
                        return (
                          <span key={id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[rgba(214,59,31,0.07)] text-[#D63B1F]">
                            <i className="fas fa-filter mr-1 text-[10px]"></i>{list?.name || 'List'}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-[#5C5A55]">All contacts (unrestricted)</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-[#E3E1DB] px-5 py-3.5 flex flex-wrap items-center gap-2">
              <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">Edit</button>
              <button onClick={onToggleActive} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                {scenario.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={onFollowups} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                <i className="fas fa-layer-group mr-1.5 text-[11px]"></i>Follow-up Stages
              </button>
              <button onClick={onExecutions} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                <i className="fas fa-list-alt mr-1.5 text-[11px]"></i>Logs
              </button>
              <button onClick={onAnalytics} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                <i className="fas fa-chart-bar mr-1.5 text-[11px]"></i>Analytics
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

// ─── Follow-up Stages Modal ───────────────────────────────────────────────────

function FollowupStagesModal({ scenario, onClose, onSuccess }) {
  const [stages, setStages] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchStages = async () => {
      try {
        const response = await apiGet(`/api/scenarios/${scenario.id}/followup-stages`)
        const data = await response.json()
        if (data.success) {
          setStages(data.stages.length > 0 ? data.stages : [
            { stage_number: 1, wait_duration: 1440, wait_unit: 'minutes', instructions: '' }
          ])
        }
      } catch (err) {
        console.error('Error fetching stages:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchStages()
  }, [scenario.id])

  const addStage = () => {
    const nextNum = stages.length + 1
    setStages([...stages, { stage_number: nextNum, wait_duration: 1440, wait_unit: 'minutes', instructions: '' }])
  }

  const removeStage = (index) => {
    const updated = stages.filter((_, i) => i !== index).map((s, i) => ({ ...s, stage_number: i + 1 }))
    setStages(updated)
  }

  const updateStage = (index, field, value) => {
    const updated = [...stages]
    updated[index] = { ...updated[index], [field]: value }
    setStages(updated)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await apiPost(`/api/scenarios/${scenario.id}/followup-stages`, { stages })
      const data = await response.json()
      if (data.success) {
        onSuccess()
        onClose()
      } else {
        setError(data.error || 'Failed to save stages')
      }
    } catch {
      setError('Failed to save stages. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const formatWaitLabel = (duration, unit) => {
    if (unit === 'minutes' && duration >= 1440) return `${duration / 1440} day${duration / 1440 !== 1 ? 's' : ''}`
    if (unit === 'minutes' && duration >= 60) return `${duration / 60} hour${duration / 60 !== 1 ? 's' : ''}`
    return `${duration} minute${duration !== 1 ? 's' : ''}`
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF] z-10">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Follow-up Stages</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">{scenario.name}</p>
          </div>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="text-center py-8">
              <i className="fas fa-spinner fa-spin text-[#9B9890] text-xl"></i>
            </div>
          ) : (
            <div className="space-y-3">
              {stages.map((stage, index) => (
                <div key={index} className="border border-[#E3E1DB] rounded-md p-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#5C5A55] uppercase tracking-wider">Stage {stage.stage_number}</span>
                    {stages.length > 1 && (
                      <button onClick={() => removeStage(index)} className="text-[#9B9890] hover:text-[#D63B1F] p-1">
                        <i className="fas fa-times text-xs"></i>
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Wait Duration</label>
                      <input
                        type="number"
                        min="1"
                        value={stage.wait_duration}
                        onChange={(e) => updateStage(index, 'wait_duration', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Unit</label>
                      <select
                        value={stage.wait_unit}
                        onChange={(e) => updateStage(index, 'wait_unit', e.target.value)}
                        className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Effective Wait</label>
                      <div className="px-3 py-2 bg-[#F7F6F3] border border-[#E3E1DB] rounded-md text-sm text-[#5C5A55]">
                        {formatWaitLabel(stage.wait_duration, stage.wait_unit)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Stage AI Instructions</label>
                    <textarea
                      value={stage.instructions}
                      onChange={(e) => updateStage(index, 'instructions', e.target.value)}
                      placeholder={`Instructions for follow-up stage ${stage.stage_number}…`}
                      rows="3"
                      className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none"
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addStage}
                className="w-full py-2 border border-dashed border-[#D4D1C9] rounded-md text-sm text-[#9B9890] hover:border-[#D63B1F] hover:text-[#D63B1F] transition-colors"
              >
                <i className="fas fa-plus mr-1.5 text-xs"></i>Add Stage
              </button>

              {error && (
                <div className="bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] text-[#D63B1F] px-3 py-2.5 rounded-md text-sm">{error}</div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50"
          >
            {saving ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</> : 'Save Stages'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Analytics Modal ──────────────────────────────────────────────────────────

function AnalyticsModal({ scenario, onClose }) {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true)
      try {
        const response = await apiGet(`/api/scenarios/${scenario.id}/analytics?days=${days}`)
        const data = await response.json()
        if (data.success) setAnalytics(data.analytics)
      } catch (err) {
        console.error('Error fetching analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchAnalytics()
  }, [scenario.id, days])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF] z-10">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Analytics</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">{scenario.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="px-2 py-1 border border-[#E3E1DB] rounded text-xs text-[#5C5A55] focus:outline-none focus:ring-1 focus:ring-[#D63B1F]"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
              <i className="fas fa-times text-sm"></i>
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="text-center py-8">
              <i className="fas fa-spinner fa-spin text-[#9B9890] text-xl"></i>
            </div>
          ) : analytics ? (
            <div className="space-y-4">
              {/* Conversations */}
              <div>
                <p className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider mb-2">Conversations</p>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total', value: analytics.conversations.total, color: 'text-[#131210]' },
                    { label: 'Active', value: analytics.conversations.active, color: 'text-[#D63B1F]' },
                    { label: 'Stopped', value: analytics.conversations.stopped, color: 'text-[#D63B1F]' },
                    { label: 'Response Rate', value: analytics.conversations.responseRate, color: 'text-green-600' },
                  ].map((item) => (
                    <div key={item.label} className="bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 text-center">
                      <p className={`text-lg font-semibold ${item.color}`}>{item.value}</p>
                      <p className="text-[11px] text-[#9B9890] mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Messages */}
              <div>
                <p className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider mb-2">Messages</p>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total', value: analytics.messages.total, color: 'text-[#131210]' },
                    { label: 'Successful', value: analytics.messages.successful, color: 'text-green-600' },
                    { label: 'Failed', value: analytics.messages.failed, color: 'text-[#D63B1F]' },
                    { label: 'Success Rate', value: analytics.messages.successRate, color: 'text-[#D63B1F]' },
                  ].map((item) => (
                    <div key={item.label} className="bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 text-center">
                      <p className={`text-lg font-semibold ${item.color}`}>{item.value}</p>
                      <p className="text-[11px] text-[#9B9890] mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Performance */}
              <div>
                <p className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider mb-2">Performance</p>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total Tokens', value: analytics.performance.totalTokens.toLocaleString(), color: 'text-[#131210]' },
                    { label: 'Avg Tokens/Msg', value: analytics.performance.avgTokensPerMessage, color: 'text-[#5C5A55]' },
                    { label: 'Avg Response', value: `${analytics.performance.avgProcessingTimeMs}ms`, color: 'text-[#5C5A55]' },
                    { label: 'Est. Cost', value: analytics.performance.estimatedCost, color: 'text-[#D63B1F]' },
                  ].map((item) => (
                    <div key={item.label} className="bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 text-center">
                      <p className={`text-lg font-semibold ${item.color}`}>{item.value}</p>
                      <p className="text-[11px] text-[#9B9890] mt-0.5">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Follow-up Stage Distribution */}
              {Object.keys(analytics.followupStages).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider mb-2">Follow-up Stage Distribution</p>
                  <div className="space-y-1.5">
                    {Object.entries(analytics.followupStages).map(([stage, count]) => (
                      <div key={stage} className="flex items-center gap-2">
                        <span className="text-xs text-[#9B9890] w-16 flex-shrink-0">Stage {stage}</span>
                        <div className="flex-1 bg-[#EFEDE8] rounded-full h-2">
                          <div
                            className="bg-[#D63B1F] h-2 rounded-full"
                            style={{ width: `${(count / analytics.conversations.total) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-[#5C5A55] w-6 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#9B9890] text-center py-8">No analytics data available</p>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E3E1DB] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Executions Modal ─────────────────────────────────────────────────────────

function ExecutionsModal({ scenario, onClose }) {
  const [executions, setExecutions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchExecutions = async () => {
      try {
        const response = await apiGet(`/api/scenarios/${scenario.id}/executions?limit=50`)
        const data = await response.json()
        if (data.success) setExecutions(data.executions || [])
      } catch (err) {
        console.error('Error fetching executions:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchExecutions()
  }, [scenario.id])

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return dateString }
  }

  const getStatusBadge = (status) => {
    const map = {
      success: 'bg-green-50 text-green-700',
      failed: 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]',
      no_reply: 'bg-[#EFEDE8] text-[#5C5A55]',
      human_needed: 'bg-orange-50 text-orange-700',
      skipped_business_hours: 'bg-yellow-50 text-yellow-700',
      processing: 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]',
    }
    return map[status] || 'bg-[#EFEDE8] text-[#5C5A55]'
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF] z-10">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Execution Logs</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">{scenario.name}</p>
          </div>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="text-center py-8">
              <i className="fas fa-spinner fa-spin text-[#9B9890] text-xl"></i>
            </div>
          ) : executions.length === 0 ? (
            <p className="text-sm text-[#9B9890] text-center py-8">No execution logs yet</p>
          ) : (
            <div className="space-y-2">
              {executions.map((exec) => (
                <div key={exec.id} className="bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#9B9890]">{formatDate(exec.created_at)}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusBadge(exec.execution_status)}`}>
                      {exec.execution_status?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[#9B9890]">
                    <span><i className="fas fa-phone-alt mr-1"></i>{exec.sender_number}</span>
                    {exec.tokens_used && <span><i className="fas fa-coins mr-1"></i>{exec.tokens_used} tokens</span>}
                    {exec.processing_time_ms && <span><i className="fas fa-clock mr-1"></i>{exec.processing_time_ms}ms</span>}
                    {exec.reply_sent && <span className="text-green-600"><i className="fas fa-check mr-1"></i>Reply sent</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E3E1DB] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Error Modal ──────────────────────────────────────────────────────────────

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

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({ scenarioName, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">Delete Scenario</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[#5C5A55]">
            Delete <span className="font-medium text-[#131210]">"{scenarioName}"</span>? This cannot be undone.
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
