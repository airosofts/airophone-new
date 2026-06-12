'use client'

import { getAvatarColor, getInitials } from '@/lib/avatar-color'

// Right-docked drawer shown when a task is opened. Task details at the top,
// the conversation's live SMS chat below (passed in via `children`).
export default function TaskDetailPanel({ task, onClose, onToggleComplete, children }) {
  if (!task) return null
  const isDone = task.status === 'completed'
  const a = task.assignee
  const due = task.due_date
    ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="flex flex-col h-full w-full" style={{ background: '#FFFFFF' }}>
      {/* Task header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #E3E1DB', flexShrink: 0 }}>
        <div className="flex items-start justify-between gap-3">
          <button
            onClick={() => onToggleComplete?.(task)}
            title={isDone ? 'Reopen task' : 'Mark as completed'}
            style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 2,
              border: isDone ? 'none' : '1.5px solid #C4C2BC',
              background: isDone ? '#2563eb' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}
          >
            {isDone && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
          </button>

          <div className="flex-1 min-w-0">
            <h3 style={{
              fontSize: 16, fontWeight: 600, color: isDone ? '#9B9890' : '#131210',
              textDecoration: isDone ? 'line-through' : 'none', lineHeight: 1.3, letterSpacing: '-0.02em',
            }}>
              {task.title}
            </h3>
            {task.description && (
              <p style={{ fontSize: 13, color: '#5C5A55', marginTop: 6, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {task.description}
              </p>
            )}

            {/* Meta */}
            <div className="flex items-center flex-wrap" style={{ gap: 16, marginTop: 12 }}>
              {/* Assignee */}
              <div className="flex items-center" style={{ gap: 7 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>
                {a ? (
                  <span className="flex items-center" style={{ gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: getAvatarColor(a.id), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 600 }}>
                      {getInitials(a.name, '')}
                    </span>
                    <span style={{ fontSize: 12.5, color: '#131210' }}>{a.name}</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 12.5, color: '#9B9890' }}>Unassigned</span>
                )}
              </div>

              {/* Due date */}
              <div className="flex items-center" style={{ gap: 7 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span style={{ fontSize: 12.5, color: due ? '#131210' : '#9B9890' }}>{due || 'No due date'}</span>
              </div>
            </div>

            {/* Complete/reopen action */}
            <button
              onClick={() => onToggleComplete?.(task)}
              style={{
                marginTop: 14, fontSize: 12.5, fontWeight: 500, padding: '7px 14px', borderRadius: 8,
                border: '1px solid #E3E1DB', cursor: 'pointer', background: '#FFFFFF', color: '#131210',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#F7F6F3'}
              onMouseLeave={e => e.currentTarget.style.background = '#FFFFFF'}
            >
              {isDone ? 'Reopen task' : 'Complete task'}
            </button>
          </div>

          <button onClick={onClose} className="p-1 rounded-md text-[#9B9890]" style={{ flexShrink: 0 }}
            onMouseEnter={e => e.currentTarget.style.background = '#F7F6F3'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Conversation chat */}
      <div className="flex-1 min-h-0 flex flex-col">
        {children}
      </div>
    </div>
  )
}
