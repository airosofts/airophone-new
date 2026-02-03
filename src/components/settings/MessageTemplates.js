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
      if (data.success) {
        setTemplates(data.templates)
      }
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteTemplate = async (templateId) => {
    try {
      const response = await fetchWithWorkspace(`/api/message-templates?id=${templateId}`, {
        method: 'DELETE'
      })
      const data = await response.json()

      if (data.success) {
        setTemplates(templates.filter(t => t.id !== templateId))
        setShowDeleteConfirm(null)
      } else {
        setShowError({
          title: 'Failed to Delete Template',
          message: data.error || 'An error occurred while deleting the template.'
        })
      }
    } catch (error) {
      console.error('Error deleting template:', error)
      setShowError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const startEdit = (template) => {
    setSelectedTemplate(template)
    setShowEditModal(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Message Templates</h2>
          <p className="text-sm text-gray-600 mt-1">Create and manage reusable message templates for campaigns</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white rounded-lg font-semibold hover:from-[#B73E34] hover:to-[#A53329] transition-all shadow-md"
        >
          <i className="fas fa-plus mr-2"></i>
          New Template
        </button>
      </div>

      {/* Templates List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 border-4 border-[#C54A3F]/20 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-[#C54A3F] border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
            <p className="text-gray-500 mt-4 font-medium">Loading templates...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-file-alt text-gray-300 text-3xl"></i>
            </div>
            <p className="text-gray-500 text-lg font-medium mb-2">No templates yet</p>
            <p className="text-sm text-gray-400">Create your first message template</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {templates.map((template) => (
              <div key={template.id} className="p-5 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{template.name}</h3>
                      {template.is_favorite && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded-full">
                          <i className="fas fa-star mr-1"></i>
                          Favorite
                        </span>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-gray-600 mb-3">{template.description}</p>
                    )}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <p className="text-sm text-gray-900 whitespace-pre-wrap">{template.message_template}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      <i className="fas fa-calendar mr-1"></i>
                      Created {new Date(template.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => startEdit(template)}
                      className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-semibold"
                    >
                      <i className="fas fa-edit mr-1"></i>
                      Edit
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(template)}
                      className="px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm font-semibold"
                    >
                      <i className="fas fa-trash mr-1"></i>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <TemplateModal
          onClose={() => setShowCreateModal(false)}
          onSave={fetchTemplates}
          onError={setShowError}
        />
      )}

      {/* Edit Modal */}
      {showEditModal && selectedTemplate && (
        <TemplateModal
          template={selectedTemplate}
          onClose={() => {
            setShowEditModal(false)
            setSelectedTemplate(null)
          }}
          onSave={fetchTemplates}
          onError={setShowError}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
                <i className="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
              </div>
              <h3 className="text-xl font-bold text-gray-900 text-center mb-2">Delete Template?</h3>
              <p className="text-sm text-gray-600 text-center mb-6">
                Are you sure you want to delete <span className="font-semibold">{showDeleteConfirm.name}</span>? This action cannot be undone.
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteTemplate(showDeleteConfirm.id)}
                  className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {showError && (
        <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
                <i className="fas fa-exclamation-circle text-red-600 text-2xl"></i>
              </div>
              <h3 className="text-xl font-bold text-gray-900 text-center mb-2">{showError.title}</h3>
              <p className="text-sm text-gray-600 text-center mb-6">{showError.message}</p>
              <button
                onClick={() => setShowError(null)}
                className="w-full px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-colors shadow-md"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Template Modal Component
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
        ? await fetchWithWorkspace(`/api/message-templates?id=${template.id}`, {
            method: 'PUT',
            body: JSON.stringify(formData)
          })
        : await apiPost('/api/message-templates', formData)

      const data = await response.json()

      if (data.success) {
        onSave()
        onClose()
      } else {
        onClose()
        onError({
          title: `Failed to ${template ? 'Update' : 'Create'} Template`,
          message: data.error || 'An error occurred.'
        })
      }
    } catch (error) {
      console.error('Error saving template:', error)
      onClose()
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="text-xl font-bold text-gray-900">
            <i className="fas fa-file-alt mr-2 text-[#C54A3F]"></i>
            {template ? 'Edit Template' : 'Create Template'}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-tag mr-1"></i>
              Template Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="e.g., Welcome Message, Follow-up, Promotion"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-align-left mr-1"></i>
              Description
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="When to use this template (optional)"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-comment-alt mr-1"></i>
              Message Template *
            </label>
            <textarea
              required
              id="template-message"
              value={formData.message_template}
              onChange={(e) => setFormData({...formData, message_template: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
              rows={6}
              placeholder="Hi {business_name}, this is a message from our business..."
              maxLength={1600}
            />
            <div className="flex justify-between items-center mt-2">
              <p className="text-xs text-gray-500">
                <i className="fas fa-info-circle mr-1"></i>
                Use {'{'}tags{'}'} like {'{'}business_name{'}'}, {'{'}phone{'}'}, {'{'}email{'}'}, etc.
              </p>
              <p className={`text-xs font-medium ${formData.message_template.length > 1500 ? 'text-red-600' : 'text-gray-500'}`}>
                {formData.message_template.length}/1600
              </p>
            </div>

            {/* Available Tags */}
            <div className="mt-3 p-4 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-[#C54A3F]/20 rounded-xl shadow-sm">
              <p className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                <i className="fas fa-tags mr-2 text-[#C54A3F]"></i>
                Available Placeholder Tags
              </p>
              <div className="flex flex-wrap gap-2">
                {['business_name', 'phone', 'email', 'city', 'state', 'country'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      const textarea = document.getElementById('template-message')
                      const start = textarea.selectionStart
                      const end = textarea.selectionEnd
                      const text = formData.message_template
                      const before = text.substring(0, start)
                      const after = text.substring(end, text.length)
                      setFormData({
                        ...formData,
                        message_template: before + `{${tag}}` + after
                      })
                      setTimeout(() => {
                        textarea.focus()
                        textarea.setSelectionRange(start + tag.length + 2, start + tag.length + 2)
                      }, 0)
                    }}
                    className="px-3 py-1.5 bg-white border-2 border-[#C54A3F] text-[#C54A3F] rounded-lg text-xs font-semibold hover:bg-[#C54A3F] hover:text-white transition-all shadow-sm hover:shadow-md"
                  >
                    <i className="fas fa-plus-circle mr-1"></i>
                    {'{' + tag + '}'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_favorite}
                onChange={(e) => setFormData({...formData, is_favorite: e.target.checked})}
                className="w-5 h-5 text-[#C54A3F] border-gray-300 rounded focus:ring-[#C54A3F]"
              />
              <span className="text-sm font-semibold text-gray-700">
                <i className="fas fa-star text-yellow-500 mr-1"></i>
                Mark as favorite
              </span>
            </label>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-all shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Saving...
                </>
              ) : (
                <>
                  <i className="fas fa-save mr-2"></i>
                  {template ? 'Update Template' : 'Create Template'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
