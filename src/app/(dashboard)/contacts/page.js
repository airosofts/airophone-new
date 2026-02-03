// app/contacts/page.jsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

export default function ContactsPage() {
  const [contactLists, setContactLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddList, setShowAddList] = useState(false)
  const [showViewContacts, setShowViewContacts] = useState(false)
  const [selectedList, setSelectedList] = useState(null)
  const [editingList, setEditingList] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [user, setUser] = useState(null)
  const [errorModal, setErrorModal] = useState(null)
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const fetchContactLists = useCallback(async () => {
    try {
      setLoading(true)
      const response = await apiGet('/api/contact-lists')
      const data = await response.json()
      if (data.success) {
        setContactLists(data.contactLists)
      }
    } catch (error) {
      console.error('Error fetching contact lists:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    fetchContactLists()
  }, [fetchContactLists])

  const filteredLists = useMemo(() => 
    contactLists.filter(list =>
      list.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      list.description?.toLowerCase().includes(searchTerm.toLowerCase())
    ), 
    [contactLists, searchTerm]
  )

  // Pagination logic
  const totalPages = Math.ceil(filteredLists.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentLists = filteredLists.slice(startIndex, endIndex)

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const handleDeleteList = async (listId) => {
    try {
      const response = await fetchWithWorkspace(`/api/contact-lists?id=${listId}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        setContactLists(contactLists.filter(l => l.id !== listId))
        setDeleteConfirm(null)
        
        // Adjust current page if needed
        const newTotalPages = Math.ceil((filteredLists.length - 1) / itemsPerPage)
        if (currentPage > newTotalPages && newTotalPages > 0) {
          setCurrentPage(newTotalPages)
        }
      } else {
        setDeleteConfirm(null)
        setErrorModal({
          title: 'Failed to Delete List',
          message: data.error || 'An error occurred while deleting the contact list.'
        })
      }
    } catch (error) {
      console.error('Error deleting list:', error)
      setDeleteConfirm(null)
      setErrorModal({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const handleUpdateList = async (listId, updates) => {
    try {
      const response = await fetchWithWorkspace(`/api/contact-lists?id=${listId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
      })

      const data = await response.json()

      if (data.success) {
        setContactLists(contactLists.map(l => 
          l.id === listId ? { ...l, ...updates } : l
        ))
        setEditingList(null)
      } else {
        setErrorModal({
          title: 'Failed to Update List',
          message: data.error || 'An error occurred while updating the contact list.'
        })
      }
    } catch (error) {
      console.error('Error updating list:', error)
      setErrorModal({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contact Lists</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your contact lists and organize your contacts
            </p>
          </div>
          <button
            onClick={() => setShowAddList(true)}
            className="px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] rounded-xl hover:from-[#B73E34] hover:to-[#A53329] transition-all shadow-lg hover:shadow-xl flex items-center space-x-2"
          >
            <i className="fas fa-plus"></i>
            <span>Create List</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <i className="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            placeholder="Search contact lists..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {/* Lists Table */}
      <div className="flex-1 overflow-hidden p-6 flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="spinner w-12 h-12"></div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
              <div className="overflow-x-auto flex-1">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        List Name
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Contacts
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {currentLists.map((list) => (
                      <tr key={list.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {editingList?.id === list.id ? (
                            <input
                              type="text"
                              value={editingList.name}
                              onChange={(e) => setEditingList({...editingList, name: e.target.value})}
                              className="px-3 py-1.5 border border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full max-w-xs"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center">
                              <div className="w-11 h-11 bg-gradient-to-br from-[#C54A3F] to-[#B73E34] rounded-xl flex items-center justify-center text-white text-sm font-bold mr-3 shadow-md">
                                {list.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm font-semibold text-gray-900">{list.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {editingList?.id === list.id ? (
                            <input
                              type="text"
                              value={editingList.description || ''}
                              onChange={(e) => setEditingList({...editingList, description: e.target.value})}
                              placeholder="Add description..."
                              className="px-3 py-1.5 border border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full max-w-md"
                            />
                          ) : (
                            <span className="text-sm text-gray-600 line-clamp-1">
                              {list.description || '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            <i className="fas fa-users mr-1.5"></i>
                            {list.contactCount || 0} contacts
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-600">
                            {new Date(list.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          {editingList?.id === list.id ? (
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => handleUpdateList(list.id, {
                                  name: editingList.name,
                                  description: editingList.description
                                })}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                              >
                                <i className="fas fa-check mr-1"></i>
                                Save
                              </button>
                              <button
                                onClick={() => setEditingList(null)}
                                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                              >
                                <i className="fas fa-times mr-1"></i>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => {
                                  setSelectedList(list)
                                  setShowViewContacts(true)
                                }}
                                className="px-3 py-1.5 text-xs font-medium text-[#C54A3F] bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                              >
                                <i className="fas fa-eye mr-1"></i>
                                View Contacts
                              </button>
                              <button
                                onClick={() => setEditingList({...list})}
                                className="p-2 text-gray-600 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
                                title="Edit list"
                              >
                                <i className="fas fa-edit"></i>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(list)}
                                className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete list"
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    
                    {currentLists.length === 0 && (
                      <tr>
                        <td colSpan="5" className="px-6 py-16 text-center">
                          <i className="fas fa-folder-open text-gray-400 text-6xl mb-4"></i>
                          <p className="text-gray-500 text-lg font-medium mb-2">No contact lists found</p>
                          <p className="text-sm text-gray-400">Create your first list to start organizing contacts</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between bg-white px-6 py-4 rounded-xl border border-gray-200">
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <span>
                    Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                    <span className="font-semibold">{Math.min(endIndex, filteredLists.length)}</span> of{' '}
                    <span className="font-semibold">{filteredLists.length}</span> lists
                  </span>
                </div>
                
                <div className="flex items-center space-x-2">
                  {/* First Page */}
                  <button
                    onClick={() => goToPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <i className="fas fa-angles-left"></i>
                  </button>

                  {/* Previous Page */}
                  <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <i className="fas fa-angle-left mr-1"></i>
                    Previous
                  </button>

                  {/* Page Numbers */}
                  <div className="flex items-center space-x-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(page => {
                        // Show first page, last page, current page, and pages around current
                        return (
                          page === 1 ||
                          page === totalPages ||
                          (page >= currentPage - 1 && page <= currentPage + 1)
                        )
                      })
                      .map((page, index, array) => (
                        <div key={page} className="flex items-center">
                          {index > 0 && array[index - 1] !== page - 1 && (
                            <span className="px-2 text-gray-400">...</span>
                          )}
                          <button
                            onClick={() => goToPage(page)}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                              currentPage === page
                                ? 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white shadow-md'
                                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        </div>
                      ))}
                  </div>

                  {/* Next Page */}
                  <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <i className="fas fa-angle-right ml-1"></i>
                  </button>

                  {/* Last Page */}
                  <button
                    onClick={() => goToPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <i className="fas fa-angles-right"></i>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showAddList && (
        <AddListModal 
          onClose={() => setShowAddList(false)}
          onListAdded={fetchContactLists}
          onError={(error) => setErrorModal(error)}
        />
      )}

      {showViewContacts && selectedList && (
        <ViewContactsModal 
          list={selectedList}
          onClose={() => {
            setShowViewContacts(false)
            setSelectedList(null)
          }}
          onContactsUpdated={fetchContactLists}
          onError={(error) => setErrorModal(error)}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal
          list={deleteConfirm}
          onConfirm={() => handleDeleteList(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {errorModal && (
        <ErrorModal
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
      )}
    </div>
  )
}

// Error Modal Component
function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-[80] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-circle text-red-600 text-2xl"></i>
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">{title}</h3>
          <p className="text-sm text-gray-600 text-center mb-6">{message}</p>

          <button
            onClick={onClose}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-colors shadow-md"
          >
            <i className="fas fa-check mr-2"></i>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// Add List Modal Component
function AddListModal({ onClose, onListAdded, onError }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await apiPost('/api/contact-lists', { name, description })

      const data = await response.json()

      if (data.success) {
        onListAdded()
        onClose()
      } else {
        onClose()
        onError({
          title: 'Failed to Create List',
          message: data.error || 'An error occurred while creating the contact list.'
        })
      }
    } catch (error) {
      console.error('Error creating list:', error)
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
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">Create New List</h3>
          <button 
            onClick={onClose} 
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-tag mr-1"></i>
              List Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="e.g., Marketing Prospects 2025"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-align-left mr-1"></i>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
              rows={3}
              placeholder="Add a description for this list..."
            />
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
                  Creating...
                </>
              ) : (
                <>
                  <i className="fas fa-plus mr-2"></i>
                  Create List
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Delete Confirm Modal
function DeleteConfirmModal({ list, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">Delete Contact List?</h3>
          <p className="text-sm text-gray-600 text-center mb-6">
            Are you sure you want to delete <span className="font-semibold">{list.name}</span>? 
            {list.contactCount > 0 && (
              <span className="block mt-2 text-red-600 font-medium">
                <i className="fas fa-exclamation-circle mr-1"></i>
                This will also delete {list.contactCount} contact{list.contactCount !== 1 ? 's' : ''}.
              </span>
            )}
          </p>

          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
            >
              <i className="fas fa-times mr-2"></i>
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Deleting...
                </>
              ) : (
                <>
                  <i className="fas fa-trash mr-2"></i>
                  Delete List
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// View Contacts Modal with Pagination
function ViewContactsModal({ list, onClose, onContactsUpdated, onError }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddContact, setShowAddContact] = useState(false)
  const [showImportCsv, setShowImportCsv] = useState(false)
  const [selectedContacts, setSelectedContacts] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [editingContact, setEditingContact] = useState(null)
  const [deleteContactConfirm, setDeleteContactConfirm] = useState(null)
  
  // Pagination for contacts
  const [currentPage, setCurrentPage] = useState(1)
  const contactsPerPage = 10

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true)
      const response = await apiGet(`/api/contacts?contact_list_id=${list.id}`)
      const data = await response.json()
      if (data.success) {
        setContacts(data.contacts)
      }
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setLoading(false)
    }
  }, [list.id])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  const filteredContacts = useMemo(() =>
    contacts.filter(contact =>
      contact.business_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone_number.includes(searchTerm) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [contacts, searchTerm]
  )

  // Pagination logic for contacts
  const totalPages = Math.ceil(filteredContacts.length / contactsPerPage)
  const startIndex = (currentPage - 1) * contactsPerPage
  const endIndex = startIndex + contactsPerPage
  const currentContacts = filteredContacts.slice(startIndex, endIndex)

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  const formatPhoneNumber = useCallback((phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    
    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }, [])

  const toggleContactSelection = useCallback((contactId) => {
    setSelectedContacts(prev => 
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    )
  }, [])

  const selectAllContacts = useCallback(() => {
    setSelectedContacts(prev => 
      prev.length === currentContacts.length ? [] : currentContacts.map(c => c.id)
    )
  }, [currentContacts])

  const deleteContact = async (contactId) => {
    try {
      const response = await fetch(`/api/contacts?id=${contactId}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        setContacts(contacts.filter(c => c.id !== contactId))
        setSelectedContacts(selectedContacts.filter(id => id !== contactId))
        setDeleteContactConfirm(null)
        onContactsUpdated()
        
        // Adjust current page if needed
        const newTotalPages = Math.ceil((filteredContacts.length - 1) / contactsPerPage)
        if (currentPage > newTotalPages && newTotalPages > 0) {
          setCurrentPage(newTotalPages)
        }
      } else {
        setDeleteContactConfirm(null)
        onError({
          title: 'Failed to Delete Contact',
          message: data.error || 'An error occurred while deleting the contact.'
        })
      }
    } catch (error) {
      console.error('Error deleting contact:', error)
      setDeleteContactConfirm(null)
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  const deleteSelectedContacts = async () => {
    try {
      const deletePromises = selectedContacts.map(contactId =>
        fetch(`/api/contacts?id=${contactId}`, { method: 'DELETE' })
      )

      await Promise.all(deletePromises)
      setContacts(contacts.filter(c => !selectedContacts.includes(c.id)))
      setSelectedContacts([])
      setDeleteContactConfirm(null)
      onContactsUpdated()
      
      // Adjust current page if needed
      const newTotalPages = Math.ceil((filteredContacts.length - selectedContacts.length) / contactsPerPage)
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setCurrentPage(newTotalPages)
      }
    } catch (error) {
      console.error('Error deleting contacts:', error)
      setDeleteContactConfirm(null)
      onError({
        title: 'Error',
        message: 'An unexpected error occurred while deleting contacts.'
      })
    }
  }

  const updateContact = async (contactId, updates) => {
    try {
      const response = await fetch(`/api/contacts?id=${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      const data = await response.json()

      if (data.success) {
        setContacts(contacts.map(c => 
          c.id === contactId ? { ...c, ...updates } : c
        ))
        setEditingContact(null)
      } else {
        onError({
          title: 'Failed to Update Contact',
          message: data.error || 'An error occurred while updating the contact.'
        })
      }
    } catch (error) {
      console.error('Error updating contact:', error)
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    }
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col animate-slideUp">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h3 className="text-2xl font-bold text-gray-900">
              <i className="fas fa-address-book mr-2 text-[#C54A3F]"></i>
              {list.name}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              <i className="fas fa-users mr-1"></i>
              {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowImportCsv(true)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              <i className="fas fa-file-csv mr-2"></i>
              Import CSV
            </button>
            <button
              onClick={() => setShowAddContact(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] rounded-xl hover:from-[#B73E34] hover:to-[#A53329] transition-all shadow-md flex items-center space-x-2"
            >
              <i className="fas fa-user-plus"></i>
              <span>Add Contact</span>
            </button>
            <button 
              onClick={onClose} 
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <i className="fas fa-times text-lg"></i>
            </button>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center space-x-4">
            <div className="flex-1 relative">
              <i className="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            {selectedContacts.length > 0 && (
              <div className="flex items-center space-x-3 bg-blue-50 px-4 py-2.5 rounded-xl border border-blue-200">
                <span className="text-sm font-medium text-blue-900">
                  <i className="fas fa-check-circle mr-1"></i>
                  {selectedContacts.length} selected
                </span>
                <button 
                  onClick={() => setDeleteContactConfirm({ multiple: true })}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                >
                  <i className="fas fa-trash mr-1"></i>
                  Delete Selected
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Contacts Table */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <i className="fas fa-spinner fa-spin text-4xl text-primary mb-3"></i>
                <p className="text-gray-500">Loading contacts...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3 text-left">
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                          checked={selectedContacts.length === currentContacts.length && currentContacts.length > 0}
                          onChange={selectAllContacts}
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Business Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Phone
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Location
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {currentContacts.map((contact) => (
                      <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                            checked={selectedContacts.includes(contact.id)}
                            onChange={() => toggleContactSelection(contact.id)}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {editingContact?.id === contact.id ? (
                            <input
                              type="text"
                              value={editingContact.business_name}
                              onChange={(e) => setEditingContact({...editingContact, business_name: e.target.value})}
                              className="px-3 py-1.5 border border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center">
                              <div className="w-9 h-9 bg-gradient-to-br from-[#C54A3F] to-[#B73E34] rounded-full flex items-center justify-center text-white text-xs font-bold mr-3 shadow-md">
                                {contact.business_name.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm font-medium text-gray-900">{contact.business_name}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {editingContact?.id === contact.id ? (
                            <input
                              type="tel"
                              value={editingContact.phone_number}
                              onChange={(e) => setEditingContact({...editingContact, phone_number: e.target.value})}
                              className="px-3 py-1.5 border border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          ) : (
                            <span className="text-sm text-gray-900">
                              <i className="fas fa-phone mr-2 text-gray-400"></i>
                              {formatPhoneNumber(contact.phone_number)}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {editingContact?.id === contact.id ? (
                            <input
                              type="email"
                              value={editingContact.email || ''}
                              onChange={(e) => setEditingContact({...editingContact, email: e.target.value})}
                              className="px-3 py-1.5 border border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          ) : (
                            <span className="text-sm text-gray-900">
                              {contact.email ? (
                                <>
                                  <i className="fas fa-envelope mr-2 text-gray-400"></i>
                                  {contact.email}
                                </>
                              ) : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-900">
                            {[contact.city, contact.state, contact.country].filter(Boolean).length > 0 ? (
                              <>
                                <i className="fas fa-map-marker-alt mr-2 text-gray-400"></i>
                                {[contact.city, contact.state, contact.country].filter(Boolean).join(', ')}
                              </>
                            ) : '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          {editingContact?.id === contact.id ? (
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => updateContact(contact.id, {
                                  name: editingContact.name,
                                  phone_number: editingContact.phone_number,
                                  email: editingContact.email
                                })}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                              >
                                <i className="fas fa-check mr-1"></i>
                                Save
                              </button>
                              <button
                                onClick={() => setEditingContact(null)}
                                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                              >
                                <i className="fas fa-times mr-1"></i>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => setEditingContact({...contact})}
                                className="p-2 text-[#C54A3F] hover:bg-red-50 rounded-lg transition-colors"
                                title="Edit contact"
                              >
                                <i className="fas fa-edit"></i>
                              </button>
                              <button 
                                onClick={() => setDeleteContactConfirm(contact)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete contact"
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    
                    {currentContacts.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-6 py-16 text-center">
                          <i className="fas fa-user-slash text-gray-400 text-6xl mb-4"></i>
                          <p className="text-gray-500 text-lg font-medium mb-2">No contacts found</p>
                          <p className="text-sm text-gray-400">Add contacts or import from CSV to get started</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Contacts Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between bg-gray-50 flex-shrink-0">
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <span>
                      Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                      <span className="font-semibold">{Math.min(endIndex, filteredContacts.length)}</span> of{' '}
                      <span className="font-semibold">{filteredContacts.length}</span> contacts
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {/* Previous Page */}
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <i className="fas fa-angle-left mr-1"></i>
                      Previous
                    </button>

                    {/* Page Numbers */}
                    <div className="flex items-center space-x-1">
                      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                        let pageNum
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (currentPage <= 3) {
                          pageNum = i + 1
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = currentPage - 2 + i
                        }
                        
                        return (
                          <button
                            key={pageNum}
                            onClick={() => goToPage(pageNum)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                              currentPage === pageNum
                                ? 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white shadow-md'
                                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                    </div>

                    {/* Next Page */}
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                      <i className="fas fa-angle-right ml-1"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sub-modals */}
        {showAddContact && (
          <AddContactModal 
            onClose={() => setShowAddContact(false)}
            contactListId={list.id}
            onContactAdded={() => {
              fetchContacts()
              onContactsUpdated()
            }}
            onError={onError}
          />
        )}

        {showImportCsv && (
          <ImportCsvModal 
            onClose={() => setShowImportCsv(false)}
            contactListId={list.id}
            onImportComplete={() => {
              fetchContacts()
              onContactsUpdated()
            }}
            onError={onError}
          />
        )}

        {deleteContactConfirm && (
          <DeleteContactConfirmModal
            contact={deleteContactConfirm}
            selectedCount={selectedContacts.length}
            onConfirm={deleteContactConfirm.multiple ? deleteSelectedContacts : () => deleteContact(deleteContactConfirm.id)}
            onCancel={() => setDeleteContactConfirm(null)}
          />
        )}
      </div>
    </div>
  )
}

// Add Contact Modal
function AddContactModal({ onClose, contactListId, onContactAdded, onError }) {
  const [formData, setFormData] = useState({
    business_name: '',
    phone_number: '',
    email: '',
    city: '',
    state: '',
    country: '',
    contact_list_id: contactListId
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await apiPost('/api/contacts', formData)

      const data = await response.json()

      if (data.success) {
        onContactAdded()
        onClose()
      } else {
        onClose()
        onError({
          title: 'Failed to Add Contact',
          message: data.error || 'An error occurred while adding the contact.'
        })
      }
    } catch (error) {
      console.error('Error adding contact:', error)
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
    <div className="fixed inset-0 backdrop-blur-md bg-white/40 flex items-center justify-center z-[60] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">
            <i className="fas fa-user-plus mr-2 text-[#C54A3F]"></i>
            Add Contact
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <i className="fas fa-building mr-1"></i>
                Business Name *
              </label>
              <input
                type="text"
                required
                value={formData.business_name}
                onChange={(e) => setFormData({...formData, business_name: e.target.value})}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="Acme Corp"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <i className="fas fa-phone mr-1"></i>
                Phone Number *
              </label>
              <input
                type="tel"
                required
                value={formData.phone_number}
                onChange={(e) => setFormData({...formData, phone_number: e.target.value})}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="+1 (555) 123-4567"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <i className="fas fa-envelope mr-1"></i>
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="john@example.com"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <i className="fas fa-city mr-1"></i>
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({...formData, city: e.target.value})}
                  className="w-full px-3 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="New York"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">State</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData({...formData, state: e.target.value})}
                  className="w-full px-3 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="NY"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <i className="fas fa-globe mr-1"></i>
                  Country
                </label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) => setFormData({...formData, country: e.target.value})}
                  className="w-full px-3 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="US"
                />
              </div>
            </div>
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
                  Adding...
                </>
              ) : (
                <>
                  <i className="fas fa-plus mr-2"></i>
                  Add Contact
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Import CSV Modal
function ImportCsvModal({ onClose, contactListId, onImportComplete, onError }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file && file.type === 'text/csv') {
      setSelectedFile(file)
      setResult(null)
    }
  }

  const handleImport = async () => {
    if (!selectedFile) return

    setLoading(true)
    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('contact_list_id', contactListId)

    try {
      // For FormData, we need to manually add headers
      const response = await fetchWithWorkspace('/api/contacts/import', {
        method: 'POST',
        body: formData,
        headers: {} // Let browser set Content-Type for FormData
      })

      const data = await response.json()
      
      if (data.success) {
        setResult(data)
        onImportComplete()
        setTimeout(() => {
          onClose()
        }, 3000)
      } else {
        setResult({ error: data.error, details: data.details })
      }
    } catch (error) {
      console.error('Error importing CSV:', error)
      setResult({ error: 'Import failed', details: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 backdrop-blur-md bg-white/40 flex items-center justify-center z-[60] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">
            <i className="fas fa-file-csv mr-2 text-[#C54A3F]"></i>
            Import CSV
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <div className={`p-5 rounded-xl ${result.error ? 'bg-red-50 border-2 border-red-200' : 'bg-green-50 border-2 border-green-200'}`}>
              {result.error ? (
                <>
                  <div className="flex items-center space-x-3 mb-2">
                    <i className="fas fa-times-circle text-red-600 text-2xl"></i>
                    <h4 className="font-bold text-red-900">Import Failed</h4>
                  </div>
                  <p className="text-sm text-red-700 mb-1">{result.error}</p>
                  {result.details && (
                    <p className="text-xs text-red-600 font-mono bg-red-100 p-2 rounded mt-2">{result.details}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center space-x-3 mb-3">
                    <i className="fas fa-check-circle text-green-600 text-2xl"></i>
                    <h4 className="font-bold text-green-900">Import Successful!</h4>
                  </div>
                  <p className="text-sm text-green-700 mb-3">{result.message}</p>
                  <div className="bg-green-100 p-3 rounded-lg space-y-1">
                    <p className="text-sm font-medium text-green-800">
                      <i className="fas fa-check mr-2"></i>
                      Imported: {result.imported}
                    </p>
                    {result.duplicates > 0 && (
                      <p className="text-sm text-green-700">
                        <i className="fas fa-ban mr-2"></i>
                        Duplicates skipped: {result.duplicates}
                      </p>
                    )}
                    {result.errors > 0 && (
                      <p className="text-sm text-green-700">
                        <i className="fas fa-exclamation-triangle mr-2"></i>
                        Parse errors: {result.errors}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">CSV File</label>
                <div className="relative">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl focus:outline-none focus:border-primary hover:border-primary transition-colors cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-primary-hover"
                  />
                </div>
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-800 font-medium mb-1">
                    <i className="fas fa-info-circle mr-1"></i>
                    CSV Format Requirements:
                  </p>
                  <p className="text-xs text-blue-700">Headers: business_name, phone, email, city, state, country</p>
                </div>
              </div>

              {selectedFile && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="flex items-center space-x-3">
                    <i className="fas fa-file-csv text-green-600 text-3xl"></i>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{selectedFile.name}</p>
                      <p className="text-xs text-gray-500">
                        <i className="fas fa-database mr-1"></i>
                        {(selectedFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              {result?.success ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleImport}
                disabled={!selectedFile || loading}
                className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-all shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
              >
                {loading ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Importing...
                  </>
                ) : (
                  <>
                    <i className="fas fa-upload mr-2"></i>
                    Import
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Delete Contact Confirm Modal
function DeleteContactConfirmModal({ contact, selectedCount, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  const isMultiple = contact.multiple && selectedCount > 0

  return (
    <div className="fixed inset-0 backdrop-blur-md bg-white/40 flex items-center justify-center z-[70] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
          </div>
          
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">
            Delete Contact{isMultiple ? 's' : ''}?
          </h3>
          <p className="text-sm text-gray-600 text-center mb-6">
            {isMultiple ? (
              <>
                Are you sure you want to delete <span className="font-bold text-red-600">{selectedCount} contact{selectedCount !== 1 ? 's' : ''}</span>? This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete <span className="font-semibold">{contact.name}</span>? This action cannot be undone.
              </>
            )}
          </p>

          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
            >
              <i className="fas fa-times mr-2"></i>
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Deleting...
                </>
              ) : (
                <>
                  <i className="fas fa-trash mr-2"></i>
                  Delete {isMultiple ? `${selectedCount}` : ''}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}