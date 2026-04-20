'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'

// ── Brand tokens ──
const C = {
  bg: '#F7F6F3', surface: '#FFFFFF', border: '#E3E1DB', border2: '#D4D1C9',
  text: '#131210', text2: '#5C5A55', text3: '#9B9890',
  red: '#D63B1F', redBg: 'rgba(214,59,31,0.07)', redDim: 'rgba(214,59,31,0.14)',
  green: '#16a34a', greenBg: 'rgba(22,163,74,0.07)',
  amber: '#d97706', amberBg: 'rgba(217,119,6,0.07)',
  sans: "'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
}

function pct(cur, prev) {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

function fmtDuration(seconds) {
  if (!seconds) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function fmtNum(n) {
  return n?.toLocaleString() ?? '—'
}

// Merge adjacent buckets so bars stay readable (max ~15 per chart)
function condenseTrend(trend, maxBars = 15) {
  if (!trend?.length || trend.length <= maxBars) return trend
  const groupSize = Math.ceil(trend.length / maxBars)
  const result = []
  for (let i = 0; i < trend.length; i += groupSize) {
    const g = trend.slice(i, i + groupSize)
    result.push({
      label: g.length > 1 ? `${g[0].label}–${g[g.length - 1].label}` : g[0].label,
      messages:         g.reduce((s, d) => s + (d.messages || 0), 0),
      messagesSent:     g.reduce((s, d) => s + (d.messagesSent || 0), 0),
      messagesReceived: g.reduce((s, d) => s + (d.messagesReceived || 0), 0),
      calls:            g.reduce((s, d) => s + (d.calls || 0), 0),
      callsOutbound:    g.reduce((s, d) => s + (d.callsOutbound || 0), 0),
      callsInbound:     g.reduce((s, d) => s + (d.callsInbound || 0), 0),
      conversations:    g.reduce((s, d) => s + (d.conversations || 0), 0),
      durationSeconds:  g.reduce((s, d) => s + (d.durationSeconds || 0), 0),
    })
  }
  return result
}

function Delta({ cur, prev }) {
  const p = pct(cur, prev)
  if (p === null) return <span style={{ color: C.text3, fontSize: 11 }}>—</span>
  const up = p >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 11, fontWeight: 600,
      color: up ? C.green : C.red,
    }}>
      {up ? '↑' : '↓'} {Math.abs(p)}%
    </span>
  )
}

// Stacked bar chart with hover tooltip
function BarChart({ data, valueKey, color = C.red, height = 72, stackKey, stackColor, stackLabel, baseLabel }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data?.length) return null
  const max = Math.max(...data.map(d => (d[valueKey] || 0)), 1)

  return (
    <div style={{ position: 'relative', overflow: 'visible' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
        {data.map((d, i) => {
          const total = d[valueKey] || 0
          const stackVal = stackKey ? (d[stackKey] || 0) : 0
          const totalH = Math.max(total > 0 ? 4 : 0, Math.round((total / max) * height))
          const stackH = total > 0 ? Math.round((stackVal / total) * totalH) : 0
          const baseH = totalH - stackH

          return (
            <div
              key={i}
              style={{ flex: 1, minWidth: 6, display: 'flex', flexDirection: 'column', alignItems: 'stretch', cursor: 'default' }}
              onMouseEnter={() => setTooltip({ idx: i, d })}
              onMouseLeave={() => setTooltip(null)}
            >
              {stackH > 0 && (
                <div style={{ height: stackH, background: stackColor || '#3b82f6', borderRadius: '2px 2px 0 0', opacity: 0.9 }} />
              )}
              {baseH > 0 && (
                <div style={{
                  height: baseH, background: color,
                  borderRadius: stackH > 0 ? '0' : '2px 2px 0 0',
                  opacity: 0.8,
                }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          bottom: height + 10,
          left: `${Math.min(Math.max((tooltip.idx / data.length) * 100, 5), 60)}%`,
          transform: 'translateX(-50%)',
          background: '#131210',
          color: '#fff',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          zIndex: 20,
          pointerEvents: 'none',
          minWidth: (stackKey || baseLabel) ? 130 : 100,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontFamily: C.mono, fontSize: 11 }}>
            {tooltip.d.label}
          </div>
          {stackKey ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: stackColor || C.red, flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.7)', flex: 1 }}>{stackLabel}</span>
                <span style={{ fontWeight: 600 }}>{tooltip.d[stackKey] || 0}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.7)', flex: 1 }}>{baseLabel}</span>
                <span style={{ fontWeight: 600 }}>{(tooltip.d[valueKey] || 0) - (tooltip.d[stackKey] || 0)}</span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ color: 'rgba(255,255,255,0.7)', flex: 1 }}>{baseLabel || valueKey}</span>
              <span style={{ fontWeight: 600 }}>{tooltip.d[valueKey] || 0}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Heatmap (7 rows × 24 cols)
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return '12am'
  if (i === 12) return '12pm'
  if (i < 12) return `${i}am`
  return `${i-12}pm`
})

function Heatmap({ data }) {
  const [tooltip, setTooltip] = useState(null)
  if (!data) return null
  const flatMax = Math.max(...data.flat(), 1)

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(24, 1fr)', gap: 2, minWidth: 640 }}>
        {/* Empty top-left corner */}
        <div />
        {HOURS.map((h, i) => (
          <div key={i} style={{ fontSize: 9, color: C.text3, textAlign: 'center', fontFamily: C.mono, paddingBottom: 3 }}>{h}</div>
        ))}
        {data.map((row, dow) => (
          <React.Fragment key={dow}>
            <div style={{ fontSize: 11, color: C.text2, display: 'flex', alignItems: 'center', fontWeight: 500 }}>
              {DAYS[dow]}
            </div>
            {row.map((val, hour) => {
              const intensity = val / flatMax
              return (
                <div
                  key={`${dow}-${hour}`}
                  onMouseEnter={() => setTooltip({ dow, hour, val })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    height: 22, borderRadius: 4, cursor: 'default',
                    background: intensity === 0
                      ? '#F0EEE9'
                      : `rgba(214,59,31,${0.12 + intensity * 0.88})`,
                    position: 'relative',
                  }}
                >
                  {tooltip?.dow === dow && tooltip?.hour === hour && val > 0 && (
                    <div style={{
                      position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)',
                      background: C.text, color: '#fff', fontSize: 11, padding: '4px 8px',
                      borderRadius: 6, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none',
                      fontFamily: C.mono,
                    }}>
                      {DAYS[dow]}, {HOURS[hour]} — {val} activities
                    </div>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// KPI Card
function KpiCard({ label, value, prev, valueDisplay, subLabel, color, chartData, chartKey, stackKey, stackColor, stackLabel, baseLabel }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 8,
      overflow: 'visible', position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: C.text3, fontWeight: 500 }}>{label}</span>
        <Delta cur={value} prev={prev} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.04em', color: C.text, lineHeight: 1 }}>
        {valueDisplay ?? fmtNum(value)}
      </div>
      {chartData && (
        <BarChart
          data={chartData} valueKey={chartKey || 'calls'} color={color || C.red} height={64}
          stackKey={stackKey} stackColor={stackColor} stackLabel={stackLabel} baseLabel={baseLabel}
        />
      )}
      {subLabel && (
        <div style={{ fontSize: 11, color: C.text3, fontFamily: C.mono, marginTop: 2 }}>{subLabel}</div>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('month')
  const [user, setUser] = useState(null)
  const [userPage, setUserPage] = useState(1)
  const perPage = 10

  useEffect(() => {
    const u = getCurrentUser()
    setUser(u)
  }, [])

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(`/api/analytics?range=${range}`)
      const json = await res.json()
      if (json.success) setData(json)
    } catch (e) {
      console.error('Analytics fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  const kpis = data?.kpis
  const trend = condenseTrend(data?.trend || [])
  const heatmap = data?.heatmap || null
  const userStats = data?.userStats || []
  const sortedUsers = [...userStats].sort((a, b) => b.totalCalls - a.totalCalls)
  const pagedUsers = sortedUsers.slice((userPage - 1) * perPage, userPage * perPage)
  const totalPages = Math.ceil(sortedUsers.length / perPage)

  const rangeLabel = range === 'day' ? 'Today' : range === 'week' ? 'Last 7 days' : 'Month to date'

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: C.sans, WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Page header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.04em', color: C.text, marginBottom: 4 }}>Analytics</h1>
            <p style={{ fontSize: 13, color: C.text3, fontWeight: 300 }}>Explore key metrics across your workspace</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Range tabs */}
            {[
              { label: 'Today', value: 'day' },
              { label: 'Weekly', value: 'week' },
              { label: 'Month to date', value: 'month' },
            ].map(r => (
              <button key={r.value} onClick={() => { setRange(r.value); setUserPage(1) }} style={{
                height: 32, padding: '0 14px', borderRadius: 7, cursor: 'pointer',
                border: `1px solid ${range === r.value ? C.red : C.border}`,
                background: range === r.value ? C.redBg : C.surface,
                color: range === r.value ? C.red : C.text2,
                fontSize: 12, fontWeight: range === r.value ? 600 : 400,
                fontFamily: C.sans, transition: 'all 0.15s',
              }}>{r.label}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ height: 148, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, opacity: 0.5 }} />
            ))}
          </div>
        ) : (
          <>
            {/* ── KPI grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 24 }}>
              <KpiCard
                label="Messages"
                value={kpis?.totalMessages}
                prev={kpis?.prevTotalMessages}
                chartData={trend} chartKey="messages"
                color="#3b82f6"
                stackKey="messagesSent" stackColor={C.red}
                stackLabel="Sent" baseLabel="Received"
              />
              <KpiCard
                label="Calls"
                value={kpis?.totalCalls}
                prev={kpis?.prevTotalCalls}
                chartData={trend} chartKey="calls"
                color="#3b82f6"
                stackKey="callsOutbound" stackColor={C.red}
                stackLabel="Outbound" baseLabel="Inbound"
              />
              <KpiCard
                label="Unique conversations"
                value={kpis?.uniqueConversations}
                prev={kpis?.prevUniqueConversations}
                chartData={trend} chartKey="conversations"
                color="#8b5cf6"
                baseLabel="Unique"
              />
              <KpiCard
                label="Time on calls"
                value={kpis?.totalDurationSeconds}
                prev={kpis?.prevTotalDurationSeconds}
                valueDisplay={fmtDuration(kpis?.totalDurationSeconds)}
                chartData={trend} chartKey="durationSeconds"
                color={C.green}
                baseLabel="Duration"
              />
            </div>

            {/* ── Activities table ── */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
              marginBottom: 24, overflow: 'hidden',
            }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.text, letterSpacing: '-0.02em' }}>Activities</span>
                  <span style={{ fontSize: 11, color: C.text3, marginLeft: 8, fontFamily: C.mono }}>{rangeLabel}</span>
                </div>
                <span style={{ fontSize: 12, color: C.text3 }}>{userStats.length} users</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F7F6F3' }}>
                      <th style={{ padding: '10px 20px', textAlign: 'left', color: C.text3, fontWeight: 600, fontSize: 11, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>User</th>
                      {[
                        { label: 'Total calls' },
                        { label: 'Outgoing calls' },
                        { label: 'Answered calls' },
                        { label: 'Time on calls' },
                        { label: 'Sent messages' },
                      ].map(h => (
                        <th key={h.label} style={{ padding: '10px 12px', textAlign: 'left', color: C.text3, fontWeight: 600, fontSize: 11, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '40px 20px', textAlign: 'center', color: C.text3, fontSize: 13 }}>
                          No activity data for this period
                        </td>
                      </tr>
                    ) : pagedUsers.map((u, idx) => (
                      <tr key={u.id} style={{ borderTop: `1px solid ${C.border}`, background: idx % 2 === 0 ? 'transparent' : '#FAFAF8' }}>
                        {/* User */}
                        <td style={{ padding: '12px 20px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {u.avatar ? (
                              <img src={u.avatar} alt={u.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                            ) : (
                              <div style={{
                                width: 28, height: 28, borderRadius: '50%', background: C.redBg,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, fontWeight: 600, color: C.red, flexShrink: 0,
                              }}>
                                {u.name?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                            )}
                            <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{u.name}</span>
                          </div>
                        </td>

                        {/* Total calls */}
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.text }}>{u.totalCalls}</span>
                            <span style={{ color: C.text3 }}>{u.prevTotalCalls}</span>
                            <Delta cur={u.totalCalls} prev={u.prevTotalCalls} />
                          </div>
                        </td>

                        {/* Outgoing calls */}
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.text }}>{u.outboundCalls}</span>
                            <span style={{ color: C.text3 }}>{u.prevOutboundCalls}</span>
                            <Delta cur={u.outboundCalls} prev={u.prevOutboundCalls} />
                          </div>
                        </td>

                        {/* Answered calls */}
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.text }}>{u.answeredCalls}</span>
                            <span style={{ color: C.text3 }}>{u.prevAnsweredCalls}</span>
                            <Delta cur={u.answeredCalls} prev={u.prevAnsweredCalls} />
                          </div>
                        </td>

                        {/* Time on calls */}
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.text, fontFamily: C.mono, fontSize: 12 }}>{fmtDuration(u.durationSeconds)}</span>
                            <span style={{ color: C.text3, fontFamily: C.mono, fontSize: 11 }}>{fmtDuration(u.prevDurationSeconds)}</span>
                            <Delta cur={u.durationSeconds} prev={u.prevDurationSeconds} />
                          </div>
                        </td>

                        {/* Sent messages */}
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.text }}>{u.sentMessages}</span>
                            <span style={{ color: C.text3 }}>{u.prevSentMessages}</span>
                            <Delta cur={u.sentMessages} prev={u.prevSentMessages} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: C.text3 }}>
                    Showing {(userPage - 1) * perPage + 1}–{Math.min(userPage * perPage, sortedUsers.length)} of {sortedUsers.length}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setUserPage(p => Math.max(1, p - 1))}
                      disabled={userPage === 1}
                      style={{
                        width: 28, height: 28, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: 'transparent', cursor: userPage === 1 ? 'not-allowed' : 'pointer',
                        opacity: userPage === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.text2} strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                    <button
                      onClick={() => setUserPage(p => Math.min(totalPages, p + 1))}
                      disabled={userPage === totalPages}
                      style={{
                        width: 28, height: 28, border: `1px solid ${C.border}`, borderRadius: 6,
                        background: 'transparent', cursor: userPage === totalPages ? 'not-allowed' : 'pointer',
                        opacity: userPage === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.text2} strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Busy times heatmap ── */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '20px 24px',
            }}>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text, letterSpacing: '-0.02em' }}>Busy times</span>
                <p style={{ fontSize: 12, color: C.text3, marginTop: 3 }}>Combined calls + messages by day and hour</p>
              </div>
              {heatmap ? <Heatmap data={heatmap} /> : (
                <p style={{ fontSize: 13, color: C.text3 }}>No data</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
