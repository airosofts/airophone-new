//components/inbox/ContactPanel.js

'use client'

import { useState, useEffect } from 'react'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'
import { fetchWithWorkspace } from '@/lib/api-client'

export default function ContactPanel({ conversation, formatPhoneNumber, user }) {
  const [contact, setContact] = useState(null)
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState({})
  const [assignedScenario, setAssignedScenario] = useState(null)
  const [aiPaused, setAiPaused] = useState(conversation.manual_override || false)
  const [togglingAi, setTogglingAi] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      await Promise.all([
        fetchContact(),
        fetchNotes(),
        fetchScenarioAssignment()
      ])
    }
    fetchData()
  }, [conversation.id])

  // Keep aiPaused in sync if parent conversation updates
  useEffect(() => {
    setAiPaused(conversation.manual_override || false)
  }, [conversation.manual_override])

  const fetchContact = async () => {
    try {
      const response = await fetch(`/api/contacts/by-phone/${encodeURIComponent(conversation.phone_number)}`)
      const data = await response.json()
      if (data.success) {
        setContact(data.contact)
      }
    } catch (error) {
      console.error('Error fetching contact:', error)
    }
  }

  const fetchNotes = async () => {
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/notes`)
      const data = await response.json()
      if (data.success) {
        setNotes(data.notes)
      }
    } catch (error) {
      console.error('Error fetching notes:', error)
    }
  }

  const fetchScenarioAssignment = async () => {
    try {
      const res = await fetchWithWorkspace(`/api/conversations/assign-scenario?conversationId=${conversation.id}`)
      const data = await res.json()
      if (data.success) {
        setAssignedScenario(data.assignedScenario || null)
      }
    } catch (error) {
      console.error('Error fetching scenario assignment:', error)
    }
  }

  const handleToggleAi = async () => {
    setTogglingAi(true)
    const newPaused = !aiPaused
    setAiPaused(newPaused) // optimistic
    try {
      const res = await fetchWithWorkspace('/api/conversations/ai-toggle', {
        method: 'POST',
        body: JSON.stringify({ conversationId: conversation.id, paused: newPaused })
      })
      const data = await res.json()
      if (!data.success) {
        setAiPaused(!newPaused) // revert
      }
    } catch (e) {
      setAiPaused(!newPaused) // revert
      console.error('Error toggling AI:', e)
    } finally {
      setTogglingAi(false)
    }
  }

  const saveContact = async (contactData) => {
    try {
      setLoading(true)
      const response = await fetch('/api/contacts', {
        method: contact ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contactData,
          phone_number: conversation.phone_number,
          id: contact?.id
        }),
      })

      const data = await response.json()
      if (data.success) {
        setContact(data.contact)
      }
    } catch (error) {
      console.error('Error saving contact:', error)
    } finally {
      setLoading(false)
    }
  }

  const addNote = async () => {
    if (!newNote.trim()) return

    try {
      const response = await fetch('/api/conversations/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation.id,
          content: newNote,
          created_by: user.userId
        }),
      })

      const data = await response.json()
      if (data.success) {
        setNotes([...notes, data.note])
        setNewNote('')
      }
    } catch (error) {
      console.error('Error adding note:', error)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const handleFieldEdit = (field, value) => {
    setEditing({ ...editing, [field]: value })
  }

  const handleFieldSave = (field) => {
    const updatedContact = { ...contact, [field]: editing[field] }
    saveContact(updatedContact)
    setEditing({ ...editing, [field]: undefined })
  }

  const displayName = contact?.name || formatPhoneNumber(conversation.phone_number)
  const initials = getInitials(displayName, conversation.phone_number)

  return (
    <div className="w-full bg-white flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Avatar and Phone */}
          <div className="text-center">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white font-semibold text-lg mx-auto mb-3"
              style={{ backgroundColor: getAvatarColor(conversation.phone_number) }}
            >
              {initials}
            </div>
            <h4 className="text-lg font-semibold text-gray-900">
              {formatPhoneNumber(conversation.phone_number)}
            </h4>
          </div>

          {/* AI Scenario Section */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">AI Scenario</span>
              </div>
              {/* AI On/Off toggle */}
              <button
                onClick={handleToggleAi}
                disabled={togglingAi}
                title={aiPaused ? 'AI paused — click to resume' : 'AI active — click to pause'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  aiPaused
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                } ${togglingAi ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${aiPaused ? 'bg-amber-500' : 'bg-green-500'}`} />
                {aiPaused ? 'Paused' : 'Active'}
              </button>
            </div>
            <div className="px-3 py-2.5">
              {assignedScenario ? (
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-[#C54A3F] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 9h6M9 12h6M9 15h4"/>
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{assignedScenario.name}</p>
                    <p className="text-[10px] text-gray-400">Explicitly assigned</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>
                  </svg>
                  <p className="text-sm text-gray-400">Default matching</p>
                </div>
              )}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2 uppercase">Name</label>
            {editing.name !== undefined ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => handleFieldEdit('name', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-gray-400"
                  placeholder="Click to add name"
                  autoFocus
                />
                <button
                  onClick={() => handleFieldSave('name')}
                  className="px-3 py-2 bg-[#C54A3F] text-white rounded-md text-sm hover:bg-[#B73E34]"
                  disabled={loading}
                >
                  Save
                </button>
              </div>
            ) : (
              <div
                onClick={() => handleFieldEdit('name', contact?.name || '')}
                className="p-3 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50"
              >
                <span className="text-sm text-gray-900">
                  {contact?.name || 'Click to add name'}
                </span>
              </div>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2 uppercase">Email</label>
            {editing.email !== undefined ? (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={editing.email}
                  onChange={(e) => handleFieldEdit('email', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-gray-400"
                  placeholder="Click to add email"
                  autoFocus
                />
                <button
                  onClick={() => handleFieldSave('email')}
                  className="px-3 py-2 bg-[#C54A3F] text-white rounded-md text-sm hover:bg-[#B73E34]"
                  disabled={loading}
                >
                  Save
                </button>
              </div>
            ) : (
              <div
                onClick={() => handleFieldEdit('email', contact?.email || '')}
                className="p-3 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50"
              >
                <span className="text-sm text-gray-900">
                  {contact?.email || 'Click to add email'}
                </span>
              </div>
            )}
          </div>

          {/* Notes Section */}
          <div className="border-t border-gray-200 pt-6">
            <label className="block text-xs font-medium text-gray-600 mb-3 uppercase">Notes</label>

            <div className="mb-4">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note for your team..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-gray-400 resize-none"
                rows={3}
              />
              {newNote.trim() && (
                <button
                  onClick={addNote}
                  className="mt-2 px-4 py-2 bg-[#C54A3F] text-white rounded-md text-sm hover:bg-[#B73E34]"
                >
                  Add Note
                </button>
              )}
            </div>

            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="p-3 bg-gray-50 rounded-md border border-gray-200">
                  <p className="text-sm text-gray-900 mb-2 whitespace-pre-wrap">{note.content}</p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{note.created_by_name || 'Team Member'}</span>
                    <span>{formatDate(note.created_at)}</span>
                  </div>
                </div>
              ))}

              {notes.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No notes yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
