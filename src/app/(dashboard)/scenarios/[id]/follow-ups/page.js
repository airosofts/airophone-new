'use client'

// Full-page follow-up sequence builder — a horizontal canvas styled like the
// Automations builder (FlowCard + curved red connectors). Replaces the old
// cramped modal. Reads/writes the same /api/scenarios/[id]/followup-stages API.

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiGet, apiPost } from '@/lib/api-client'

// One card on the canvas (matches AutomationBuilder's FlowCard).
function FlowCard({ badge, badgeBg, title, subtitle, accent = '#D63B1F', width = 'w-[340px]', children, headerRight }) {
  return (
    <div className={`${width} shrink-0 bg-white rounded-xl border border-[#E3E1DB] shadow-sm`}>
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl border-b border-[#EFEDE8]" style={{ background: `${accent}0D` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
          style={{ background: badgeBg || accent, borderColor: badgeBg ? '#E3E1DB' : 'transparent' }}>
          {badge}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#131210] leading-tight truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-[#9B9890] leading-tight truncate">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

// Curved connector with an optional condition pill above it.
function FlowArrow({ label, tone = 'red' }) {
  const stroke = tone === 'green' ? '#16A34A' : '#D63B1F'
  const pill = tone === 'green'
    ? 'bg-[#F1F9F4] border-[#CDE9D6] text-[#16A34A]'
    : 'bg-white border-[#E3E1DB] text-[#9B9890]'
  return (
    <div className="flex-1 min-w-[72px] px-1.5 self-center flex flex-col items-center justify-center gap-1.5" aria-hidden>
      {label && <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${pill}`}>{label}</span>}
      <div className="w-full flex items-center">
        <svg className="flex-1 h-8" viewBox="0 0 100 32" preserveAspectRatio="none" fill="none">
          <path d="M0 16 C 30 16, 30 5, 50 5 C 70 5, 70 16, 100 16"
            stroke={stroke} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <svg width="9" height="12" viewBox="0 0 9 12" className="-ml-px shrink-0">
          <path d="M9 6L0 0v12z" fill={stroke} />
        </svg>
      </div>
    </div>
  )
}

const inputCls = 'px-2.5 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]'

// Tiny Monday tri-dot mark for the per-stage status field.
function MondayDot() {
  return (
    <svg width="13" height="13" viewBox="0 0 32 32" fill="none" className="inline-block shrink-0">
      <circle cx="6" cy="16" r="5" fill="#FF3D57" />
      <circle cx="16" cy="16" r="5" fill="#FFCB00" />
      <circle cx="26" cy="16" r="5" fill="#00CA72" />
    </svg>
  )
}

export default function FollowUpSequencePage() {
  const { id } = useParams()
  const router = useRouter()

  const [scenarioName, setScenarioName] = useState('')
  const [stages, setStages] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedTick, setSavedTick] = useState(false)
  // Real Monday status columns (+ labels) for this scenario's board(s).
  const [statusCols, setStatusCols] = useState([])   // [{ id, title, labels, board_name }]
  const [multiBoard, setMultiBoard] = useState(false)

  const load = useCallback(async () => {
    try {
      const [scRes, stRes, mcRes] = await Promise.all([
        apiGet(`/api/scenarios/${id}`),
        apiGet(`/api/scenarios/${id}/followup-stages`),
        apiGet(`/api/scenarios/${id}/monday-status-columns`),
      ])
      const sc = await scRes.json().catch(() => ({}))
      const st = await stRes.json().catch(() => ({}))
      const mc = await mcRes.json().catch(() => ({}))
      setScenarioName(sc?.scenario?.name || sc?.name || 'Scenario')
      const list = st?.stages || []
      setStages(list.length > 0 ? list : [{ stage_number: 1, wait_duration: 1, wait_unit: 'days', instructions: '' }])

      // Flatten board → status columns; dedupe by column id (union labels).
      const boards = mc?.boards || []
      setMultiBoard(boards.length > 1)
      const map = new Map()
      for (const b of boards) {
        for (const c of (b.columns || [])) {
          const ex = map.get(c.id)
          if (ex) ex.labels = [...new Set([...ex.labels, ...c.labels])]
          else map.set(c.id, { id: c.id, title: c.title, labels: [...c.labels], board_name: b.board_name })
        }
      }
      setStatusCols([...map.values()])
    } catch {
      setError('Failed to load this sequence.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const addStage = () => setStages(s => [...s, { stage_number: s.length + 1, wait_duration: 2, wait_unit: 'days', instructions: '' }])
  const removeStage = (index) => setStages(s => s.filter((_, i) => i !== index).map((x, i) => ({ ...x, stage_number: i + 1 })))
  const updateStage = (index, field, value) => setStages(s => s.map((x, i) => i === index ? { ...x, [field]: value } : x))

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await apiPost(`/api/scenarios/${id}/followup-stages`, { stages })
      const data = await res.json()
      if (data.success) { setSavedTick(true); setTimeout(() => setSavedTick(false), 2000) }
      else setError(data.error || 'Failed to save sequence')
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const formatWaitLabel = (duration, unit) => {
    const n = Number(duration) || 0
    if (unit === 'minutes' && n >= 1440 && n % 1440 === 0) return `${n / 1440} day${n / 1440 !== 1 ? 's' : ''}`
    if (unit === 'minutes' && n >= 60 && n % 60 === 0) return `${n / 60} hour${n / 60 !== 1 ? 's' : ''}`
    const word = { minutes: 'minute', hours: 'hour', days: 'day', weeks: 'week' }[unit] || 'minute'
    return `${n} ${word}${n !== 1 ? 's' : ''}`
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
        <button onClick={() => router.push('/scenarios')} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0">
            <i className="fas fa-layer-group text-white text-xs" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#131210] leading-tight truncate">Follow-up sequence</p>
            <p className="text-[11px] text-[#9B9890] leading-tight truncate">{scenarioName}</p>
          </div>
        </div>
        <button onClick={() => router.push('/scenarios')} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Back</button>
        <button onClick={save} disabled={saving || loading}
          className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : savedTick ? <><i className="fas fa-check mr-1.5" />Saved</> : 'Save sequence'}
        </button>
      </div>

      {/* Rule banner */}
      <div className="flex gap-2.5 items-center px-5 py-2.5 bg-[#FBF3F1] border-b border-[rgba(214,59,31,0.14)] shrink-0">
        <i className="fas fa-circle-info text-[#D63B1F] text-sm"></i>
        <p className="text-xs text-[#5C5A55]">
          These messages send <span className="font-semibold text-[#131210]">only if the lead hasn’t replied</span>. The moment they reply, every follow-up stops and your AI takes over.
        </p>
      </div>

      {error && (
        <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>
      )}

      {/* Canvas */}
      <div className="flex-1 overflow-auto" style={{ background: '#FAF9F6', backgroundImage: 'radial-gradient(#E0DED7 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-[#9B9890]"><i className="fas fa-spinner fa-spin text-xl" /></div>
        ) : (
          <div className="flex items-start w-full p-10" style={{ minWidth: 'max-content' }}>

            {/* Start */}
            <FlowCard accent="#2563EB" badge={<i className="fas fa-paper-plane text-white text-xs" />} title="First message sent" subtitle="Trigger" width="w-[260px]">
              <p className="text-xs text-[#5C5A55] leading-relaxed">Your template or AI message goes out to the new lead. The sequence below begins counting from here.</p>
            </FlowCard>

            {/* Stages */}
            {stages.map((stage, index) => (
              <div key={index} className="flex items-stretch">
                <FlowArrow label={index === 0 ? 'if no reply' : 'if still no reply'} />
                <FlowCard
                  accent="#D63B1F"
                  width="w-[380px]"
                  badge={<span className="text-white text-[11px] font-bold">{stage.stage_number}</span>}
                  title={`Follow-up ${stage.stage_number}`}
                  subtitle="Sent automatically if still no reply"
                  headerRight={stages.length > 1 ? (
                    <button onClick={() => removeStage(index)} title="Remove" className="text-[#9B9890] hover:text-[#D63B1F] p-1 shrink-0">
                      <i className="fas fa-trash-can text-xs"></i>
                    </button>
                  ) : null}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm text-[#5C5A55]">
                    <span>Wait</span>
                    <input type="number" min="1" value={stage.wait_duration}
                      onChange={(e) => updateStage(index, 'wait_duration', parseInt(e.target.value) || 1)}
                      className={`${inputCls} w-16 text-center`} />
                    <select value={stage.wait_unit} onChange={(e) => updateStage(index, 'wait_unit', e.target.value)} className={inputCls}>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-[#9B9890] -mt-1">≈ {formatWaitLabel(stage.wait_duration, stage.wait_unit)} after the previous message, then send:</p>
                  <textarea value={stage.instructions} onChange={(e) => updateStage(index, 'instructions', e.target.value)}
                    rows="4"
                    placeholder={"What should this message say? e.g. “Hey {{first_name}}, just checking in — still interested? Happy to answer any questions.”"}
                    className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none" />

                  {/* Optional Monday status when this stage fires — real columns + labels */}
                  <div className="pt-2 border-t border-[#EFEDE8]">
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#5C5A55] mb-1.5">
                      <MondayDot /> Set Monday status <span className="text-[#9B9890] font-normal">(optional)</span>
                    </label>
                    {statusCols.length === 0 ? (
                      <p className="text-[11px] text-[#9B9890] leading-relaxed">Add an automation on this scenario’s line (with a status column) to set a Monday status here.</p>
                    ) : (() => {
                      const selCol = statusCols.find(c => c.id === stage.monday_status_column_id)
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={stage.monday_status_column_id || ''}
                            onChange={(e) => { updateStage(index, 'monday_status_column_id', e.target.value); updateStage(index, 'monday_status_label', '') }}
                            className={`${inputCls} flex-1 min-w-[130px]`}>
                            <option value="">— No status —</option>
                            {statusCols.map(c => <option key={c.id} value={c.id}>{multiBoard ? `${c.board_name} · ${c.title}` : c.title}</option>)}
                          </select>
                          {selCol && (
                            <>
                              <span className="text-xs text-[#9B9890]">to</span>
                              <select
                                value={stage.monday_status_label || ''}
                                onChange={(e) => updateStage(index, 'monday_status_label', e.target.value)}
                                className={`${inputCls} flex-1 min-w-[130px]`}>
                                <option value="">— Choose a label —</option>
                                {selCol.labels.map(l => <option key={l} value={l}>{l}</option>)}
                              </select>
                            </>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </FlowCard>
              </div>
            ))}

            {/* Add */}
            <FlowArrow label="then" />
            <button onClick={addStage}
              className="w-[200px] shrink-0 self-center flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#D4D1C9] bg-white/60 py-8 text-sm text-[#9B9890] hover:border-[#D63B1F] hover:text-[#D63B1F] transition-colors">
              <i className="fas fa-plus text-lg"></i>
              Add follow-up
            </button>

            {/* End */}
            <FlowArrow label="any reply, any time" tone="green" />
            <FlowCard accent="#16A34A" badge={<i className="fas fa-check text-white text-xs" />} title="Lead replies → ends" subtitle="AI takes over" width="w-[240px]">
              <p className="text-xs text-[#5C5A55] leading-relaxed">As soon as the lead responds, any remaining follow-ups are cancelled and your AI scenario handles the conversation.</p>
            </FlowCard>

          </div>
        )}
      </div>
    </div>
  )
}
