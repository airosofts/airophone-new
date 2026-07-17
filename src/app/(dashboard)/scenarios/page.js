'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

import { useState } from 'react'
import ScenarioAgentChat from '@/components/scenarios/ScenarioAgentChat'
import ScenarioForm from '@/components/scenarios/ScenarioForm'

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
                        <button onClick={(e) => { e.stopPropagation(); router.push(`/scenarios/new?test=${scenario.id}`) }}
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
                            <button onClick={(e) => { e.stopPropagation(); router.push(`/scenarios/new?test=${scenario.id}`) }}
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

  if (!manual) {
    return <ScenarioAgentChat onSwitchToManual={() => setManual(true)} />
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      <div className="flex items-center justify-end px-5 py-2 bg-white border-b border-[#E3E1DB] shrink-0">
        <button onClick={() => setManual(false)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D63B1F] hover:underline">
          <i className="fas fa-wand-magic-sparkles text-[11px]" />
          Use the assistant instead
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ScenarioForm mode="create" />
      </div>
    </div>
  )
}
