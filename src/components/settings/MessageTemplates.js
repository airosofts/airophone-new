'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

export default function MessageTemplates() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [showError, setShowError] = useState(null)

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const response = await apiGet('/api/message-templates')
      const data = await response.json()
      if (data.success) setTemplates(data.templates)
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteTemplate = async (templateId) => {
    try {
      const response = await fetchWithWorkspace(`/api/message-templates?id=${templateId}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setTemplates(templates.filter(t => t.id !== templateId))
        setShowDeleteConfirm(null)
      } else {
        setShowError({ title: 'Delete Failed', message: data.error || 'An error occurred.' })
      }
    } catch (error) {
      setShowError({ title: 'Error', message: 'An unexpected error occurred.' })
    }
  }

  return (
    <div className="space-y-4">
      {/* Error modal */}
      {showError && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">{showError.title}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">{showError.message}</p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
              <button onClick={() => setShowError(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Delete Template</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">Delete <span className="font-medium text-[#131210]">"{showDeleteConfirm.name}"</span>? This cannot be undone.</p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={() => deleteTemplate(showDeleteConfirm.id)} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Templates card */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Message Templates</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">Reusable templates for campaigns</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <i className="fas fa-plus text-xs"></i>
            <span className="hidden sm:inline">New Template</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-[#9B9890]">
            <i className="fas fa-spinner fa-spin mr-2"></i>Loading…
          </div>
        ) : templates.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9B9890]">No templates yet</p>
            <p className="text-xs text-[#9B9890] mt-1">Create reusable message templates for your campaigns</p>
          </div>
        ) : (
          <div className="divide-y divide-[#E3E1DB]">
            {templates.map((template) => (
              <div key={template.id} className="px-5 py-4 hover:bg-[#F7F6F3]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-medium text-[#131210]">{template.name}</h4>
                      {template.is_favorite && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-50 text-yellow-700 rounded">
                          <i className="fas fa-star mr-0.5"></i>Favorite
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-xs text-[#9B9890] mb-2">{template.description}</p>
                    )}
                    <p className="text-sm text-[#5C5A55] bg-[#F7F6F3] border border-[#E3E1DB] rounded px-3 py-2 whitespace-pre-wrap">
                      {template.message_template}
                    </p>
                    <p className="text-xs text-[#9B9890] mt-1.5">
                      Created {new Date(template.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => { setSelectedTemplate(template); setShowEditModal(true) }}
                      className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(template)}
                      className="px-2.5 py-1.5 text-xs text-red-600 border border-red-100 rounded hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <TemplateModal onClose={() => setShowCreateModal(false)} onSave={fetchTemplates} onError={setShowError} />
      )}
      {showEditModal && selectedTemplate && (
        <TemplateModal
          template={selectedTemplate}
          onClose={() => { setShowEditModal(false); setSelectedTemplate(null) }}
          onSave={fetchTemplates}
          onError={setShowError}
        />
      )}
    </div>
  )
}

function TemplateModal({ template, onClose, onSave, onError }) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    message_template: template?.message_template || '',
    description: template?.description || '',
    is_favorite: template?.is_favorite || false
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = template
        ? await fetchWithWorkspace(`/api/message-templates?id=${template.id}`, { method: 'PUT', body: JSON.stringify(formData) })
        : await apiPost('/api/message-templates', formData)
      const data = await response.json()
      if (data.success) { onSave(); onClose() }
      else { onClose(); onError({ title: `Failed to ${template ? 'Update' : 'Create'}`, message: data.error || 'An error occurred.' }) }
    } catch (error) {
      onClose(); onError({ title: 'Error', message: 'An unexpected error occurred.' })
    } finally {
      setLoading(false)
    }
  }

  const tags = ['business_name', 'phone', 'email', 'city', 'state', 'country']

  const insertTag = (tag) => {
    const textarea = document.getElementById('template-message')
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = formData.message_template
    const newText = text.substring(0, start) + `{${tag}}` + text.substring(end)
    setFormData({ ...formData, message_template: newText })
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + tag.length + 2, start + tag.length + 2)
    }, 0)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] sticky top-0 bg-[#FFFFFF]">
          <h3 className="text-sm font-semibold text-[#131210]">{template ? 'Edit Template' : 'New Template'}</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Template Name *</label>
            <input
              type="text" required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Welcome Message"
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="When to use this template (optional)"
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[#5C5A55]">Message *</label>
              <span className={`text-xs ${formData.message_template.length > 1500 ? 'text-red-500' : 'text-[#9B9890]'}`}>
                {formData.message_template.length}/1600
              </span>
            </div>
            <textarea
              required id="template-message"
              value={formData.message_template}
              onChange={(e) => setFormData({ ...formData, message_template: e.target.value })}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none"
              rows={5}
              placeholder="Hi {business_name}, this is a message from our team..."
              maxLength={1600}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-xs text-[#9B9890] self-center mr-1">Insert:</span>
              {tags.map((tag) => (
                <button
                  key={tag} type="button" onClick={() => insertTag(tag)}
                  className="px-2 py-0.5 text-xs border border-[#E3E1DB] rounded text-[#5C5A55] hover:bg-[#F7F6F3] hover:border-[#D4D1C9] font-mono"
                >
                  {'{' + tag + '}'}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_favorite}
              onChange={(e) => setFormData({ ...formData, is_favorite: e.target.checked })}
              className="w-4 h-4 text-[#D63B1F] rounded border-[#D4D1C9] focus:ring-[#D63B1F]"
            />
            <span className="text-sm text-[#5C5A55]">Mark as favorite</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
            <button
              type="submit" disabled={loading}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50"
            >
              {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</> : template ? 'Update Template' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
