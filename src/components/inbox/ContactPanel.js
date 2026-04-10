//components/inbox/ContactPanel.js

'use client'

import { useState, useEffect } from 'react'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'
import { fetchWithWorkspace } from '@/lib/api-client'
import MentionTextarea, { renderNoteWithMentions } from './MentionTextarea'

const FIELD_TYPES = [
  { type: 'text',     label: 'Text' },
  { type: 'number',   label: 'Number' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'date',     label: 'Date' },
  { type: 'url',      label: 'URL' },
  { type: 'address',  label: 'Address' },
  { type: 'tags',     label: 'Tags' },
]

function Icon({ type, className = 'w-4 h-4 text-[#9B9890]' }) {
  const p = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8' }
  switch (type) {
    case 'company': return <svg {...p}><rect x="3" y="7" width="18" height="14" rx="1.5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    case 'role':    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
    case 'phone':   return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.38 2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
    case 'email':   return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>
    case 'date':    return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
    case 'tags':    return <svg {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
    case 'text':    return <svg {...p}><path d="M4 7h16M4 12h10M4 17h7"/></svg>
    case 'number':  return <svg {...p}><path d="M9 3H5l-1 6h2M9 3l-1 6M14 3h1l1 6h-2M14 3l1 6M5 9h14M5 15h14M8 15v6M16 15v6"/></svg>
    case 'checkbox':return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
    case 'url':     return <svg {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
    case 'address': return <svg {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
    case 'ai':      return <svg {...p}><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
    default:        return <svg {...p}><path d="M4 7h16M4 12h10M4 17h7"/></svg>
  }
}

export default function ContactPanel({ conversation, formatPhoneNumber, user, onContactUpdated, highlightNoteId }) {
  const [contact, setContact]           = useState(null)
  const [notes, setNotes]               = useState([])
  const [newNote, setNewNote]           = useState('')
  const [mentionedUsers, setMentionedUsers] = useState([])
  const [loading, setLoading]           = useState(false)
  const [editingName, setEditingName]   = useState(false)
  const [nameEdit, setNameEdit]         = useState({ first_name: '', last_name: '' })
  const [editingField, setEditingField] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [assignedScenario, setAssignedScenario] = useState(null)
  const [aiPaused, setAiPaused]         = useState(conversation.manual_override || false)
  const [togglingAi, setTogglingAi]     = useState(false)
  // custom fields
  const [showAddProp, setShowAddProp]   = useState(false)
  const [newPropLabel, setNewPropLabel] = useState('')
  const [newPropType, setNewPropType]   = useState('text')
  const [editCustomIdx, setEditCustomIdx]     = useState(null)
  const [editCustomValue, setEditCustomValue] = useState('')

  useEffect(() => {
    Promise.all([fetchContact(), fetchNotes(), fetchScenario()])
  }, [conversation.id])

  useEffect(() => {
    setAiPaused(conversation.manual_override || false)
  }, [conversation.manual_override])

  const fetchContact = async () => {
    try {
      const res  = await fetchWithWorkspace(`/api/contacts/by-phone/${encodeURIComponent(conversation.phone_number)}`)
      const data = await res.json()
      if (data.success) setContact(data.contact)
    } catch (e) { console.error(e) }
  }

  const fetchNotes = async () => {
    try {
      const res  = await fetchWithWorkspace(`/api/conversations/${conversation.id}/notes`)
      const data = await res.json()
      if (data.success) setNotes(data.notes)
    } catch (e) { console.error(e) }
  }

  const fetchScenario = async () => {
    try {
      const res  = await fetchWithWorkspace(`/api/conversations/assign-scenario?conversationId=${conversation.id}`)
      const data = await res.json()
      if (data.success) setAssignedScenario(data.assignedScenario || null)
    } catch (e) { console.error(e) }
  }

  const handleToggleAi = async () => {
    setTogglingAi(true)
    const next = !aiPaused
    setAiPaused(next)
    try {
      const res  = await fetchWithWorkspace('/api/conversations/ai-toggle', {
        method: 'POST',
        body: JSON.stringify({ conversationId: conversation.id, paused: next })
      })
      const data = await res.json()
      if (!data.success) setAiPaused(!next)
    } catch { setAiPaused(!next) }
    finally { setTogglingAi(false) }
  }

  const saveContact = async (fields) => {
    try {
      setLoading(true)
      const url = contact ? `/api/contacts?id=${contact.id}` : '/api/contacts'
      const res  = await fetchWithWorkspace(url, {
        method: contact ? 'PUT' : 'POST',
        body: JSON.stringify({ ...fields, phone_number: conversation.phone_number })
      })
      const data = await res.json()
      if (data.success) {
        setContact(data.contact)
        onContactUpdated?.(data.contact)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const saveNameEdit = () => {
    setEditingName(false)
    saveContact({ ...contact, ...nameEdit })
  }

  const saveField = (field) => {
    setEditingField(null)
    saveContact({ ...contact, [field]: editingValue })
  }

  const getCustomFields = () => {
    if (!contact?.custom_fields) return []
    return Array.isArray(contact.custom_fields) ? contact.custom_fields : []
  }

  const saveCustomValue = (idx) => {
    const fields = [...getCustomFields()]
    fields[idx] = { ...fields[idx], value: editCustomValue }
    setEditCustomIdx(null)
    saveContact({ ...contact, custom_fields: fields })
  }

  const addCustomField = () => {
    if (!newPropLabel.trim()) return
    const fields = [...getCustomFields()]
    fields.push({
      id: Date.now().toString(),
      label: newPropLabel.trim(),
      type: newPropType,
      value: newPropType === 'checkbox' ? false : newPropType === 'tags' ? [] : ''
    })
    setShowAddProp(false); setNewPropLabel(''); setNewPropType('text')
    saveContact({ ...contact, custom_fields: fields })
  }

  const deleteCustomField = (idx) => {
    const fields = getCustomFields().filter((_, i) => i !== idx)
    saveContact({ ...contact, custom_fields: fields })
  }

  const addNote = async () => {
    if (!newNote.trim()) return
    try {
      const res  = await fetchWithWorkspace('/api/conversations/notes', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: conversation.id, content: newNote, mentioned_users: mentionedUsers })
      })
      const data = await res.json()
      if (data.success) { setNotes([...notes, data.note]); setNewNote(''); setMentionedUsers([]) }
    } catch (e) { console.error(e) }
  }

  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const personalName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null : null
  const avatarLabel  = personalName || contact?.business_name || formatPhoneNumber(conversation.phone_number)
  const initials     = getInitials(avatarLabel, conversation.phone_number)
  const customFields = getCustomFields()

  return (
    <div className="w-full bg-[#FFFFFF] flex flex-col h-full overflow-y-auto">

      {/* ── Header ── */}
      <div className="flex flex-col items-center px-6 pt-7 pb-5 border-b border-[#E3E1DB]">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl mb-3 select-none"
          style={{ backgroundColor: getAvatarColor(conversation.phone_number) }}
        >
          {initials}
        </div>

        {editingName ? (
          <div className="w-full space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={nameEdit.first_name}
                onChange={(e) => setNameEdit(n => ({ ...n, first_name: e.target.value }))}
                placeholder="First name"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveNameEdit(); if (e.key === 'Escape') setEditingName(false) }}
                className="flex-1 text-sm px-2.5 py-1.5 border border-[#D4D1C9] rounded-md focus:outline-none focus:border-[#D63B1F] min-w-0"
              />
              <input
                type="text"
                value={nameEdit.last_name}
                onChange={(e) => setNameEdit(n => ({ ...n, last_name: e.target.value }))}
                placeholder="Last name"
                onKeyDown={(e) => { if (e.key === 'Enter') saveNameEdit(); if (e.key === 'Escape') setEditingName(false) }}
                className="flex-1 text-sm px-2.5 py-1.5 border border-[#D4D1C9] rounded-md focus:outline-none focus:border-[#D63B1F] min-w-0"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingName(false)} className="text-xs px-3 py-1.5 text-[#9B9890] hover:text-[#5C5A55] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={saveNameEdit} disabled={loading} className="text-xs px-3 py-1.5 bg-[#D63B1F] text-white rounded-md hover:bg-[#c23119]">Save</button>
            </div>
          </div>
        ) : (
         
          <button
            onClick={() => { setEditingName(true); setNameEdit({ first_name: contact?.first_name || '', last_name: contact?.last_name || '' }) }}
            className={`text-lg leading-tight text-center hover:opacity-70 transition-opacity ${personalName ? 'text-[#131210] font-semibold' : 'text-[#9B9890] font-normal'}`}
          >
            {personalName || 'Add a name…'}
          </button>
        )}

        {!editingName && (
          <p className="text-sm text-[#9B9890] mt-0.5">{formatPhoneNumber(conversation.phone_number)}</p>
        )}
      </div>

      {/* ── AI Scenario ── */}
      <div className="px-5 py-3 border-b border-[#E3E1DB] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Icon type="ai" className="w-4 h-4 text-[#9B9890] flex-shrink-0" />
          <span className="text-sm text-[#9B9890] truncate">
            {assignedScenario ? assignedScenario.name : 'Default matching'}
          </span>
        </div>
        <button
          onClick={handleToggleAi}
          disabled={togglingAi}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ml-2 transition-colors ${
            aiPaused
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              : 'bg-green-100 text-green-700 hover:bg-green-200'
          } ${togglingAi ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${aiPaused ? 'bg-amber-500' : 'bg-green-500'}`} />
          {aiPaused ? 'Paused' : 'Active'}
        </button>
      </div>

      {/* ── Contact Fields ── */}
      <div className="px-5 py-3">
        <ContactField
          icon={<Icon type="company" />}
          label="Company"
          value={contact?.business_name}
          placeholder="Set a company"
          editing={editingField === 'business_name'}
          editValue={editingValue}
          onEditValueChange={setEditingValue}
          onStartEdit={() => { setEditingField('business_name'); setEditingValue(contact?.business_name || '') }}
          onSave={() => saveField('business_name')}
          onCancel={() => setEditingField(null)}
        />
        <ContactField
          icon={<Icon type="role" />}
          label="Role"
          value={contact?.role}
          placeholder="Set a role"
          editing={editingField === 'role'}
          editValue={editingValue}
          onEditValueChange={setEditingValue}
          onStartEdit={() => { setEditingField('role'); setEditingValue(contact?.role || '') }}
          onSave={() => saveField('role')}
          onCancel={() => setEditingField(null)}
        />
        {/* Phone — read only */}
        <div className="flex items-center gap-3 py-2.5">
          <span className="flex-shrink-0"><Icon type="phone" /></span>
          <span className="text-sm text-[#9B9890] w-16 flex-shrink-0">Phone</span>
          <span className="text-sm text-[#131210]">{formatPhoneNumber(conversation.phone_number)}</span>
        </div>
        <ContactField
          icon={<Icon type="email" />}
          label="Email"
          value={contact?.email}
          placeholder="Set an email…"
          editing={editingField === 'email'}
          editValue={editingValue}
          onEditValueChange={setEditingValue}
          onStartEdit={() => { setEditingField('email'); setEditingValue(contact?.email || '') }}
          onSave={() => saveField('email')}
          onCancel={() => setEditingField(null)}
          inputType="email"
        />

        {/* Custom fields */}
        {customFields.map((field, idx) => (
          <CustomField
            key={field.id || idx}
            field={field}
            editing={editCustomIdx === idx}
            editValue={editCustomValue}
            onEditValueChange={setEditCustomValue}
            onStartEdit={() => { setEditCustomIdx(idx); setEditCustomValue(field.value ?? '') }}
            onSave={() => saveCustomValue(idx)}
            onCancel={() => setEditCustomIdx(null)}
            onDelete={() => deleteCustomField(idx)}
            onToggle={() => {
              const f = [...customFields]
              f[idx] = { ...f[idx], value: !f[idx].value }
              saveContact({ ...contact, custom_fields: f })
            }}
          />
        ))}

        {/* Add a property */}
        {showAddProp ? (
          <div className="mt-3 rounded-xl border border-[#E3E1DB] overflow-hidden bg-[#FFFFFF] shadow-sm">
            <div className="px-4 py-3 border-b border-[#E3E1DB]">
              <input
                type="text"
                value={newPropLabel}
                onChange={(e) => setNewPropLabel(e.target.value)}
                placeholder="Property name…"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCustomField()
                  if (e.key === 'Escape') { setShowAddProp(false); setNewPropLabel('') }
                }}
                className="w-full text-sm focus:outline-none bg-transparent placeholder-[#9B9890]"
              />
            </div>
            <div className="px-3 py-2 grid grid-cols-2 gap-0.5">
              {FIELD_TYPES.map(ft => (
                <button
                  key={ft.type}
                  onClick={() => setNewPropType(ft.type)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left ${
                    newPropType === ft.type
                      ? 'bg-[#D63B1F]/10 text-[#D63B1F] font-medium'
                      : 'text-[#5C5A55] hover:bg-[#F7F6F3]'
                  }`}
                >
                  <Icon type={ft.type} className={`w-4 h-4 flex-shrink-0 ${newPropType === ft.type ? 'text-[#D63B1F]' : 'text-[#9B9890]'}`} />
                  {ft.label}
                </button>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-[#E3E1DB] flex gap-2 justify-end">
              <button onClick={() => { setShowAddProp(false); setNewPropLabel('') }} className="text-sm px-3 py-1.5 text-[#9B9890] hover:text-[#5C5A55] rounded-lg hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={addCustomField} disabled={!newPropLabel.trim()} className="text-sm px-3 py-1.5 bg-[#D63B1F] text-white rounded-lg hover:bg-[#c23119] disabled:opacity-40">Add</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddProp(true)}
            className="flex items-center gap-2 mt-2 text-sm text-[#9B9890] hover:text-[#5C5A55] transition-colors py-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add a property
          </button>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="px-5 py-4 border-t border-[#E3E1DB]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-[#5C5A55]">Notes</span>
          {notes.length > 0 && (
            <span className="text-[11px] text-[#9B9890] bg-[#EFEDE8] rounded-full px-2 py-0.5 font-medium">{notes.length}</span>
          )}
        </div>

        {/* Note input with @mention support */}
        <div className="border border-[#E3E1DB] rounded-lg overflow-hidden bg-[#F7F6F3] focus-within:border-[#D4D1C9] focus-within:bg-[#FFFFFF] transition-all">
          <MentionTextarea
            value={newNote}
            onChange={(text, userIds) => { setNewNote(text); if (userIds) setMentionedUsers(userIds) }}
            onSubmit={addNote}
            placeholder="Write a note... use @ to mention"
          />
          <div className="flex items-center justify-between px-2.5 pb-2">
            <span className="text-[10px] text-[#D4D1C9]">@ to mention</span>
            {newNote.trim() && (
              <button
                onClick={addNote}
                className="text-[11px] font-medium px-3 py-1 bg-[#D63B1F] text-white rounded-md hover:bg-[#c23119] transition-colors"
              >
                Save
              </button>
            )}
          </div>
        </div>

        {/* Existing notes */}
        {notes.length > 0 && (
          <div className="mt-3 space-y-px">
            {notes.map((note) => (
              <div
                key={note.id}
                id={`note-${note.id}`}
                className={`group px-3 py-2.5 rounded-lg hover:bg-[#F7F6F3] transition-colors ${
                  highlightNoteId === note.id ? 'ring-2 ring-[#D63B1F]/30 bg-red-50/30' : ''
                }`}
              >
                <p className="text-[13px] text-[#5C5A55] whitespace-pre-wrap leading-snug">{renderNoteWithMentions(note.content)}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[11px] text-[#9B9890] font-medium">{note.created_by_name || 'Team'}</span>
                  <span className="text-[11px] text-[#D4D1C9]">·</span>
                  <span className="text-[11px] text-[#9B9890]">{formatDate(note.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {notes.length === 0 && !newNote && (
          <p className="text-[12px] text-[#9B9890] text-center py-3">No notes yet</p>
        )}
      </div>

    </div>
  )
}

// ── Reusable field row ──
function ContactField({ icon, label, value, placeholder, editing, editValue, onEditValueChange, onStartEdit, onSave, onCancel, inputType = 'text' }) {
  return (
    <div className="flex items-center gap-3 py-2.5 group">
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-sm text-[#9B9890] w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type={inputType}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
            onBlur={onSave}
            autoFocus
            className="w-full text-sm text-[#131210] bg-transparent border-0 border-b border-blue-400 focus:outline-none py-0.5"
          />
        ) : (
          <button
            onClick={onStartEdit}
            className={`text-sm text-left w-full truncate transition-colors ${
              value ? 'text-[#131210] hover:text-[#D63B1F]' : 'text-[#9B9890] hover:text-[#9B9890]'
            }`}
          >
            {value || placeholder}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Custom field row ──
function CustomField({ field, editing, editValue, onEditValueChange, onStartEdit, onSave, onCancel, onDelete, onToggle }) {
  const displayVal = field.type === 'tags'
    ? (Array.isArray(field.value) ? field.value.join(', ') : field.value) || ''
    : field.value || ''

  return (
    <div className="flex items-center gap-3 py-2.5 group">
      <span className="flex-shrink-0"><Icon type={field.type} /></span>
      <span className="text-sm text-[#9B9890] w-16 flex-shrink-0 truncate" title={field.label}>{field.label}</span>
      <div className="flex-1 min-w-0">
        {field.type === 'checkbox' ? (
          <button onClick={onToggle} className="flex items-center">
            <div className={`w-4 h-4 rounded border-2 transition-colors flex items-center justify-center ${field.value ? 'bg-[#D63B1F] border-[#D63B1F]' : 'border-[#D4D1C9] hover:border-[#9B9890]'}`}>
              {field.value && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 5 5 9-9"/></svg>}
            </div>
          </button>
        ) : editing ? (
          <input
            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
            onBlur={onSave}
            autoFocus
            placeholder={`Add ${field.label.toLowerCase()}`}
            className="w-full text-sm text-[#131210] bg-transparent border-0 border-b border-blue-400 focus:outline-none py-0.5"
          />
        ) : (
          <button
            onClick={onStartEdit}
            className={`text-sm text-left w-full truncate transition-colors ${displayVal ? 'text-[#131210] hover:text-[#D63B1F]' : 'text-[#9B9890] hover:text-[#9B9890]'}`}
          >
            {displayVal || `Set ${field.label.toLowerCase()}…`}
          </button>
        )}
      </div>
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-[#D4D1C9] hover:text-red-400 transition-all p-0.5">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}
