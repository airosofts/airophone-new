//components/inbox/ContactPanel.js

'use client'

import { useState, useEffect } from 'react'

export default function ContactPanel({ conversation, formatPhoneNumber, user }) {
  const [contact, setContact] = useState(null)
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState({})

  useEffect(() => {
    const fetchData = async () => {
      await Promise.all([
        fetchContact(),
        fetchNotes()
      ])
    }

    fetchData()
  }, [conversation.id])

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
  const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="w-full bg-white flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Avatar and Phone */}
          <div className="text-center">
            <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-2xl mx-auto mb-3">
              {initials}
            </div>
            <h4 className="text-lg font-semibold text-gray-900">
              {formatPhoneNumber(conversation.phone_number)}
            </h4>
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
                  className="px-3 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800"
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
                  className="px-3 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800"
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
                  className="mt-2 px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800"
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
