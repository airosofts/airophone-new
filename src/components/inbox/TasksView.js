'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '@/lib/api-client'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

const TAB_BTN = (active) => ({
  fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em',
  color: active ? '#131210' : '#9B9890',
  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
  borderBottom: active ? '2px solid #D63B1F' : '2px solid transparent',
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
})

function formatDue(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Full-width Tasks page shown when the inbox "Tasks" tab is active.
// Self-fetches; re-fetches when the status/assignee filters or refreshKey change.
export default function TasksView({
  inboxTab,
  setInboxTab,
  onTaskSelect,
  selectedTaskId,
  refreshKey,
  onToggleComplete,
  formatPhoneNumber,
}) {
  const [statusFilter, setStatusFilter] = useState('todo') // todo | completed
  const [assignedToMe, setAssignedToMe] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        assignee: assignedToMe ? 'me' : 'all',
      })
      const res = await apiGet(`/api/tasks?${params}`)
      const data = await res.json()
      setTasks(data.success ? (data.tasks || []) : [])
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter, assignedToMe])

  useEffect(() => { load() }, [load, refreshKey])

  const fmtPhone = (n) => (formatPhoneNumber ? formatPhoneNumber(n) : n)

  const convName = (conv) => {
    if (!conv) return '—'
    return conv.name || fmtPhone(conv.phone_number)
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col" style={{ background: '#FFFFFF' }}>
      {/* Header: tabs */}
      <div className="flex items-center justify-between" style={{ padding: '12px 20px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setInboxTab('chats')} style={TAB_BTN(inboxTab === 'chats')}>Chats</button>
          <button onClick={() => setInboxTab('calls')} style={TAB_BTN(inboxTab === 'calls')}>Calls</button>
          <button onClick={() => setInboxTab('tasks')} style={TAB_BTN(inboxTab === 'tasks')}>Tasks</button>
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid #E3E1DB' }}>
        {/* Status dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setStatusOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12.5, fontWeight: 500, padding: '6px 12px', borderRadius: 8,
              border: 'none', cursor: 'pointer',
              background: 'rgba(214,59,31,0.07)', color: '#D63B1F',
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            }}
          >
            {statusFilter === 'todo' ? 'To do' : 'Completed'}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {statusOpen && (
            <>
              <div className="fixed inset-0 z-[40]" onClick={() => setStatusOpen(false)} />
              <div style={{ position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 50, width: 150, background: '#FFFFFF', border: '1px solid #E3E1DB', borderRadius: 10, boxShadow: '0 8px 24px rgba(19,18,16,0.12)', padding: '4px 0' }}>
                {[{ id: 'todo', label: 'To do' }, { id: 'completed', label: 'Completed' }].map(o => (
                  <button key={o.id} onClick={() => { setStatusFilter(o.id); setStatusOpen(false) }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 13, border: 'none', cursor: 'pointer', background: 'transparent', color: statusFilter === o.id ? '#D63B1F' : '#5C5A55', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F7F6F3'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Assigned to me toggle */}
        <button
          onClick={() => setAssignedToMe(v => !v)}
          style={{
            fontSize: 12.5, fontWeight: assignedToMe ? 500 : 400, padding: '6px 12px', borderRadius: 8,
            border: 'none', cursor: 'pointer',
            background: assignedToMe ? 'rgba(214,59,31,0.07)' : '#F7F6F3',
            color: assignedToMe ? '#D63B1F' : '#5C5A55',
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          }}
        >
          Assigned to me
        </button>
      </div>

      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid #E3E1DB' }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: '#9B9890', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Tasks {!loading && <span style={{ color: '#C4C2BC' }}>{tasks.length}</span>}
        </div>
        <div style={{ width: 180, fontSize: 11, fontWeight: 600, color: '#9B9890', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Conversation</div>
        <div style={{ width: 170, fontSize: 11, fontWeight: 600, color: '#9B9890', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assignee</div>
        <div style={{ width: 90, fontSize: 11, fontWeight: 600, color: '#9B9890', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Due date</div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div style={{ padding: 24, fontSize: 13, color: '#9B9890' }}>Loading tasks…</div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 13, background: '#EFEDE8', border: '1px solid #E3E1DB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#131210', marginBottom: 4 }}>
              No {statusFilter === 'todo' ? 'to-do' : 'completed'} tasks
            </p>
            <p style={{ fontSize: 12.5, color: '#9B9890' }}>Right-click a conversation and choose “Create new task”.</p>
          </div>
        ) : (
          tasks.map(task => {
            const isDone = task.status === 'completed'
            const isSelected = selectedTaskId === task.id
            const a = task.assignee
            return (
              <div
                key={task.id}
                onClick={() => onTaskSelect?.(task)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px', borderBottom: '1px solid #E3E1DB',
                  cursor: 'pointer', background: isSelected ? '#F7F6F3' : 'transparent',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#FAF9F6' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                {/* Checkbox + title */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleComplete?.(task) }}
                    title={isDone ? 'Mark as to-do' : 'Mark as completed'}
                    style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      border: isDone ? 'none' : '1.5px solid #C4C2BC',
                      background: isDone ? '#2563eb' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', padding: 0,
                    }}
                  >
                    {isDone && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </button>
                  <span style={{
                    fontSize: 13.5, color: isDone ? '#9B9890' : '#131210',
                    textDecoration: isDone ? 'line-through' : 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {task.title}
                  </span>
                </div>

                {/* Conversation */}
                <div style={{ width: 180, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(task.conversation?.phone_number || ''), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 600 }}>
                    {getInitials(convName(task.conversation), task.conversation?.phone_number)}
                  </span>
                  <span style={{ fontSize: 12.5, color: '#5C5A55', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {convName(task.conversation)}
                  </span>
                </div>

                {/* Assignee */}
                <div style={{ width: 170, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {a ? (
                    <>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: getAvatarColor(a.id), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 600 }}>
                        {getInitials(a.name, '')}
                      </span>
                      <span style={{ fontSize: 12.5, color: '#5C5A55', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12.5, color: '#C4C2BC' }}>Unassigned</span>
                  )}
                </div>

                {/* Due date */}
                <div style={{ width: 90, fontSize: 12.5, color: '#9B9890', fontFamily: "'JetBrains Mono', monospace" }}>
                  {formatDue(task.due_date)}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
