'use client'

import { useState, useEffect } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

// Create-task modal opened from a conversation's right-click menu.
// Collects name, description, assignee (teammate), and due date.
export default function CreateTaskModal({ conversation, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState(null) // { id, name, ... }
  const [dueDate, setDueDate] = useState('')
  const [members, setMembers] = useState([])
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    apiGet('/api/team/members')
      .then(r => r.json())
      .then(d => { if (active && d.success) setMembers(d.members || []) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const contactLabel =
    conversation?.name ||
    [conversation?.contact_first_name, conversation?.contact_last_name].filter(Boolean).join(' ') ||
    conversation?.phone_number || ''

  const handleCreate = async () => {
    if (!title.trim()) { setError('Task name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await apiPost('/api/tasks', {
        conversation_id: conversation.id,
        title: title.trim(),
        description: description.trim() || null,
        assigned_to: assignee?.id || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create task'); return }
      onCreated?.(data.task)
      onClose?.()
    } catch {
      setError('Failed to create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-semibold text-[#131210]">New task</h3>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-[#F7F6F3] text-[#9B9890]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          {contactLabel && (
            <p className="text-xs text-[#9B9890] mb-4">For conversation with <span className="text-[#5C5A55] font-medium">{contactLabel}</span></p>
          )}

          {/* Task name */}
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task name..."
            className="w-full text-[15px] font-medium text-[#131210] placeholder:text-[#9B9890] outline-none bg-transparent mb-3"
          />

          {/* Description */}
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Task description..."
            rows={3}
            className="w-full text-sm text-[#131210] placeholder:text-[#9B9890] outline-none resize-none bg-transparent mb-4"
          />

          {/* Assignee + Due date */}
          <div className="flex items-center gap-2 mb-4">
            {/* Assignee dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAssigneeOpen(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E3E1DB] hover:bg-[#F7F6F3] text-sm text-[#131210]"
              >
                {assignee ? (
                  <>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white" style={{ background: getAvatarColor(assignee.id) }}>
                      {getInitials(assignee.name, '')}
                    </span>
                    <span className="truncate max-w-[120px]">{assignee.name}</span>
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.8"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    <span className="text-[#5C5A55]">Assignee</span>
                  </>
                )}
              </button>
              {assigneeOpen && (
                <>
                  <div className="fixed inset-0 z-[75]" onClick={() => setAssigneeOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-[80] w-56 max-h-64 overflow-y-auto bg-white border border-[#E3E1DB] rounded-xl shadow-lg py-1">
                    {assignee && (
                      <button onClick={() => { setAssignee(null); setAssigneeOpen(false) }} className="w-full text-left px-3 py-2 text-sm text-[#9B9890] hover:bg-[#F7F6F3]">
                        Unassigned
                      </button>
                    )}
                    {members.length === 0 && (
                      <div className="px-3 py-2 text-xs text-[#9B9890]">No teammates found</div>
                    )}
                    {members.map(m => (
                      <button key={m.id} onClick={() => { setAssignee(m); setAssigneeOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#131210] hover:bg-[#F7F6F3]">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0" style={{ background: getAvatarColor(m.id) }}>
                          {getInitials(m.name, '')}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{m.name}</span>
                          {m.email && <span className="block text-[11px] text-[#9B9890] truncate">{m.email}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Due date */}
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E3E1DB] hover:bg-[#F7F6F3] text-sm cursor-pointer text-[#5C5A55]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="outline-none bg-transparent text-[#131210] text-sm"
              />
            </label>
          </div>

          {error && <p className="text-xs text-[#D63B1F] mb-3">{error}</p>}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-[#5C5A55] hover:bg-[#F7F6F3]">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !title.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#D63B1F] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
