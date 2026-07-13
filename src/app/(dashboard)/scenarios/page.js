'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

export default function ScenariosPage() {
  const router = useRouter()
  const [scenarios, setScenarios] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedScenario, setSelectedScenario] = useState(null)
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
      if (data.success) {
        const updated = data.scenarios || []
        setScenarios(updated)
        // Keep selectedScenario in sync so modals don't show stale data after a save
        setSelectedScenario(prev => prev ? (updated.find(s => s.id === prev.id) || prev) : null)
      }
    } catch (error) {
      console.error('Error fetching scenarios:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const open = () => router.push('/scenarios/new')
    const close = () => {}
    window.addEventListener('tour:open-scenario-modal', open)
    window.addEventListener('tour:close-scenario-modal', close)
    return () => {
      window.removeEventListener('tour:open-scenario-modal', open)
      window.removeEventListener('tour:close-scenario-modal', close)
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
      <div className="p-4 md:p-6 space-y-4">

        {/* Main Card */}
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
          {/* Card Header — stacked on mobile, single row on desktop */}
          <div data-tour="scenarios-header" className="px-4 py-3 border-b border-[#E3E1DB] space-y-2.5 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4 md:px-5 md:py-3.5">
            {/* Row 1: title + new button */}
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[#131210]">AI Scenarios</h3>
              <button
                data-tour="new-scenario-btn"
                onClick={() => router.push('/scenarios/new')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <i className="fas fa-plus text-xs"></i>
                <span className="hidden sm:inline">New Scenario</span>
                <span className="sm:hidden">New</span>
              </button>
            </div>
            {/* Row 2: search + filter */}
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
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* List */}
          {paginatedScenarios.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-[#9B9890]">No scenarios found</p>
              <p className="text-xs text-[#9B9890] mt-1">
                {scenarios.length === 0 ? 'Create your first AI scenario to get started' : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <>
              {/* ── Mobile card list ── */}
              <div className="md:hidden divide-y divide-[#E3E1DB]">
                {paginatedScenarios.map((scenario) => (
                  <div
                    key={scenario.id}
                    className="px-4 py-3.5 cursor-pointer active:bg-[#F7F6F3]"
                    onClick={() => router.push(`/scenarios/${scenario.id}/edit`)}
                  >
                    {/* Name + status */}
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p className="text-sm font-semibold text-[#131210] leading-snug flex-1 min-w-0">{scenario.name}</p>
                      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        scenario.is_active ? 'bg-green-50 text-green-700' : 'bg-[#EFEDE8] text-[#5C5A55]'
                      }`}>
                        {scenario.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {/* Description */}
                    <p className="text-xs text-[#9B9890] truncate mb-2.5">
                      {scenario.description || scenario.instructions?.slice(0, 70) + '…'}
                    </p>
                    {/* Meta + actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {scenario.enable_followups && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[rgba(214,59,31,0.07)] text-[#D63B1F]">
                            <i className="fas fa-robot text-[9px]"></i>Follow-ups
                          </span>
                        )}
                        {scenario.scenario_phone_numbers?.length > 0 && (
                          <span className="text-xs text-[#9B9890] truncate">
                            <i className="fas fa-phone text-[10px] mr-1"></i>
                            {scenario.scenario_phone_numbers.length} line{scenario.scenario_phone_numbers.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); router.push(`/scenarios/${scenario.id}/sandbox`) }}
                          title="Practice chat — see how the AI replies, without texting anyone"
                          className="px-2.5 py-1 text-xs font-medium text-[#D63B1F] border border-[#D63B1F]/40 rounded-md hover:bg-[rgba(214,59,31,0.06)] transition-colors">
                          <i className="fas fa-vial mr-1 text-[10px]" />Test
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); router.push(`/scenarios/${scenario.id}/edit`) }}
                          className="px-2.5 py-1 text-xs font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors">Edit</button>
                        <RowActions
                          scenario={scenario}
                          onFollowups={() => router.push(`/scenarios/${scenario.id}/follow-ups`)}
                          onExecutions={() => { setSelectedScenario(scenario); setShowExecutionsModal(true) }}
                          onAnalytics={() => { setSelectedScenario(scenario); setShowAnalyticsModal(true) }}
                          onToggle={() => handleToggleActive(scenario)}
                          onDelete={() => setDeleteConfirm({ scenarioId: scenario.id, scenarioName: scenario.name })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Desktop table ── */}
              <div className="hidden md:block overflow-x-auto">
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
                      <tr key={scenario.id} className="hover:bg-[#F7F6F3] cursor-pointer" onClick={() => router.push(`/scenarios/${scenario.id}/edit`)}>
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-[#131210]">{scenario.name}</p>
                          <p className="text-xs text-[#9B9890] truncate max-w-xs mt-0.5">{scenario.description || scenario.instructions?.slice(0, 60) + '…'}</p>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${scenario.is_active ? 'bg-green-50 text-green-700' : 'bg-[#EFEDE8] text-[#5C5A55]'}`}>
                            {scenario.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-[#5C5A55]">
                          {scenario.scenario_phone_numbers?.length > 0
                            ? scenario.scenario_phone_numbers.map(spn => spn.phone_numbers?.phone_number || spn.phone_number_id).join(', ')
                            : <span className="text-[#9B9890] text-xs">None assigned</span>}
                        </td>
                        <td className="px-5 py-3">
                          {scenario.enable_followups
                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(214,59,31,0.07)] text-[#D63B1F]"><i className="fas fa-robot text-[10px]"></i>Enabled</span>
                            : <span className="text-xs text-[#9B9890]">Disabled</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/scenarios/${scenario.id}/sandbox`) }}
                              title="Practice chat — see how the AI replies, without texting anyone"
                              className="px-2.5 py-1 text-xs font-medium text-[#D63B1F] border border-[#D63B1F]/40 rounded-md hover:bg-[rgba(214,59,31,0.06)] transition-colors">
                              <i className="fas fa-vial mr-1 text-[10px]" />Test
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/scenarios/${scenario.id}/edit`) }}
                              className="px-2.5 py-1 text-xs font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors">Edit</button>
                            <RowActions
                              scenario={scenario}
                              onFollowups={() => router.push(`/scenarios/${scenario.id}/follow-ups`)}
                              onExecutions={() => { setSelectedScenario(scenario); setShowExecutionsModal(true) }}
                              onAnalytics={() => { setSelectedScenario(scenario); setShowAnalyticsModal(true) }}
                              onToggle={() => handleToggleActive(scenario)}
                              onDelete={() => setDeleteConfirm({ scenarioId: scenario.id, scenarioName: scenario.name })}
                            />
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


// ─── Row actions dropdown (clear, labeled) ───────────────────────────────────

function RowActions({ scenario, onFollowups, onExecutions, onAnalytics, onToggle, onDelete }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const MENU_W = 208   // w-52

  // Measure the trigger and pin a fixed-position menu to the viewport so a
  // scrolling / overflow-clipped table section can never cut it off; flip up
  // when there isn't room below.
  const place = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const MENU_H = 232, GAP = 6
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < MENU_H + GAP && r.top > spaceBelow
    setPos({
      left: Math.max(8, r.right - MENU_W),
      top: openUp ? undefined : r.bottom + GAP,
      bottom: openUp ? window.innerHeight - r.top + GAP : undefined,
    })
  }

  useEffect(() => {
    if (!open) return
    const reposition = () => place()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const item = (icon, label, onClick, danger) => (
    <button onClick={(e) => { e.stopPropagation(); setOpen(false); onClick() }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${danger ? 'text-[#D63B1F] hover:bg-[rgba(214,59,31,0.06)]' : 'text-[#5C5A55] hover:bg-[#F7F6F3]'}`}>
      <i className={`fas ${icon} w-4 text-center text-xs`} />{label}
    </button>
  )
  return (
    <div className="relative inline-block">
      <button ref={btnRef} onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen(o => !o) }} title="More actions"
        className="p-1.5 text-[#9B9890] hover:text-[#131210] hover:bg-[#F7F6F3] rounded transition-colors">
        <i className="fas fa-ellipsis-vertical text-[14px]" />
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W }}
            className="bg-white border border-[#E3E1DB] rounded-lg shadow-xl z-[9999] py-1">
            {item('fa-layer-group', 'Follow-up stages', onFollowups)}
            {item('fa-list-alt', 'Execution logs', onExecutions)}
            {item('fa-chart-bar', 'Analytics', onAnalytics)}
            {item(scenario.is_active ? 'fa-pause' : 'fa-play', scenario.is_active ? 'Deactivate' : 'Activate', onToggle)}
            <div className="my-1 border-t border-[#EFEDE8]" />
            {item('fa-trash', 'Delete scenario', onDelete, true)}
          </div>
        </>,
        document.body
      )}
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
