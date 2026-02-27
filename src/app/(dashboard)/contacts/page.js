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

  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const fetchContactLists = useCallback(async () => {
    try {
      setLoading(true)
      const response = await apiGet('/api/contact-lists')
      const data = await response.json()
      if (data.success) setContactLists(data.contactLists)
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

  const totalPages = Math.ceil(filteredLists.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentLists = filteredLists.slice(startIndex, endIndex)

  useEffect(() => { setCurrentPage(1) }, [searchTerm])

  const handleDeleteList = async (listId) => {
    try {
      const response = await fetchWithWorkspace(`/api/contact-lists?id=${listId}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setContactLists(contactLists.filter(l => l.id !== listId))
        setDeleteConfirm(null)
      } else {
        setErrorModal({ title: 'Failed to Delete', message: data.error || 'An error occurred.' })
      }
    } catch (error) {
      console.error('Error deleting list:', error)
      setErrorModal({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
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
        setContactLists(contactLists.map(l => l.id === listId ? { ...l, ...updates } : l))
        setEditingList(null)
      } else {
        setErrorModal({ title: 'Failed to Update List', message: data.error || 'An error occurred.' })
      }
    } catch (error) {
      console.error('Error updating list:', error)
      setErrorModal({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    }
  }

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-auto">
      <div className="p-6 space-y-4">

        {/* Main Card */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {/* Card Header */}
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 flex-shrink-0">Contact Lists</h3>
              <div className="relative flex-1 max-w-xs">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input
                  type="text"
                  placeholder="Search lists…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
                />
              </div>
            </div>
            <button
              onClick={() => setShowAddList(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors flex-shrink-0"
            >
              <i className="fas fa-plus text-xs"></i>
              New List
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              <i className="fas fa-spinner fa-spin mr-2"></i>Loading…
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">List Name</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Contacts</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentLists.map((list) => (
                      <tr key={list.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          {editingList?.id === list.id ? (
                            <input
                              type="text"
                              value={editingList.name}
                              onChange={(e) => setEditingList({ ...editingList, name: e.target.value })}
                              className="px-3 py-1.5 border border-[#C54A3F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] w-full max-w-xs"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 bg-[#C54A3F] rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {list.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm font-medium text-gray-900">{list.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editingList?.id === list.id ? (
                            <input
                              type="text"
                              value={editingList.description || ''}
                              onChange={(e) => setEditingList({ ...editingList, description: e.target.value })}
                              placeholder="Add description…"
                              className="px-3 py-1.5 border border-[#C54A3F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] w-full max-w-md"
                            />
                          ) : (
                            <span className="text-sm text-gray-500 line-clamp-1">
                              {list.description || '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            <i className="fas fa-users mr-1 text-[10px]"></i>
                            {list.contactCount || 0}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {new Date(list.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {editingList?.id === list.id ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleUpdateList(list.id, { name: editingList.name, description: editingList.description })}
                                className="px-2.5 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingList(null)}
                                className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setSelectedList(list); setShowViewContacts(true) }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                                title="View contacts"
                              >
                                <i className="fas fa-address-book text-[11px]"></i>
                                View
                              </button>
                              <button
                                onClick={() => setEditingList({ ...list })}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                                title="Rename list"
                              >
                                <i className="fas fa-pen text-[11px]"></i>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(list)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete list"
                              >
                                <i className="fas fa-trash-alt text-[11px]"></i>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}

                    {currentLists.length === 0 && (
                      <tr>
                        <td colSpan="5" className="px-5 py-10 text-center">
                          <p className="text-sm text-gray-500">No contact lists found</p>
                          <p className="text-xs text-gray-400 mt-1">Create your first list to start organizing contacts</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
                  <p className="text-xs text-gray-500">
                    {startIndex + 1}–{Math.min(endIndex, filteredLists.length)} of {filteredLists.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => goToPage(1)}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angles-left"></i>
                    </button>
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-left"></i>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(page => page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1))
                      .map((page, index, array) => (
                        <div key={page} className="flex items-center">
                          {index > 0 && array[index - 1] !== page - 1 && (
                            <span className="px-1.5 text-gray-400 text-xs">…</span>
                          )}
                          <button
                            onClick={() => goToPage(page)}
                            className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                              currentPage === page
                                ? 'bg-[#C54A3F] text-white border-[#C54A3F]'
                                : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        </div>
                      ))}
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-right"></i>
                    </button>
                    <button
                      onClick={() => goToPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angles-right"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
          onClose={() => { setShowViewContacts(false); setSelectedList(null) }}
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

function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">{message}</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">OK</button>
        </div>
      </div>
    </div>
  )
}

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
      if (data.success) { onListAdded(); onClose() }
      else { onClose(); onError({ title: 'Failed to Create List', message: data.error || 'An error occurred.' }) }
    } catch {
      onClose(); onError({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">New Contact List</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">List Name *</label>
            <input
              type="text" required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              placeholder="e.g., Marketing Prospects 2025"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F] resize-none"
              rows={3}
              placeholder="Add a description for this list…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
            <button
              type="submit" disabled={loading}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50"
            >
              {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Creating…</> : 'Create List'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ list, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Delete Contact List</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">
            Delete <span className="font-medium text-gray-900">"{list.name}"</span>? This cannot be undone.
            {list.contactCount > 0 && (
              <span className="block mt-1.5 text-xs text-red-600">
                <i className="fas fa-exclamation-circle mr-1"></i>
                This will also delete {list.contactCount} contact{list.contactCount !== 1 ? 's' : ''}.
              </span>
            )}
          </p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button onClick={handleConfirm} disabled={loading} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50">
            {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Deleting…</> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewContactsModal({ list, onClose, onContactsUpdated, onError }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddContact, setShowAddContact] = useState(false)
  const [showImportCsv, setShowImportCsv] = useState(false)
  const [selectedContacts, setSelectedContacts] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [editingContact, setEditingContact] = useState(null)
  const [deleteContactConfirm, setDeleteContactConfirm] = useState(null)

  const [currentPage, setCurrentPage] = useState(1)
  const contactsPerPage = 10

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true)
      const response = await apiGet(`/api/contacts?contact_list_id=${list.id}`)
      const data = await response.json()
      if (data.success) setContacts(data.contacts)
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setLoading(false)
    }
  }, [list.id])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  const filteredContacts = useMemo(() =>
    contacts.filter(contact =>
      contact.business_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.phone_number.includes(searchTerm) ||
      contact.email?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [contacts, searchTerm]
  )

  const totalPages = Math.ceil(filteredContacts.length / contactsPerPage)
  const startIndex = (currentPage - 1) * contactsPerPage
  const endIndex = startIndex + contactsPerPage
  const currentContacts = filteredContacts.slice(startIndex, endIndex)

  useEffect(() => { setCurrentPage(1) }, [searchTerm])

  const goToPage = (page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))

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
      prev.includes(contactId) ? prev.filter(id => id !== contactId) : [...prev, contactId]
    )
  }, [])

  const selectAllContacts = useCallback(() => {
    setSelectedContacts(prev =>
      prev.length === currentContacts.length ? [] : currentContacts.map(c => c.id)
    )
  }, [currentContacts])

  const deleteContact = async (contactId) => {
    try {
      const response = await fetch(`/api/contacts?id=${contactId}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setContacts(contacts.filter(c => c.id !== contactId))
        setSelectedContacts(selectedContacts.filter(id => id !== contactId))
        setDeleteContactConfirm(null)
        onContactsUpdated()
        const newTotalPages = Math.ceil((filteredContacts.length - 1) / contactsPerPage)
        if (currentPage > newTotalPages && newTotalPages > 0) setCurrentPage(newTotalPages)
      } else {
        setDeleteContactConfirm(null)
        onError({ title: 'Failed to Delete Contact', message: data.error || 'An error occurred.' })
      }
    } catch {
      setDeleteContactConfirm(null)
      onError({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    }
  }

  const deleteSelectedContacts = async () => {
    try {
      await Promise.all(selectedContacts.map(contactId =>
        fetch(`/api/contacts?id=${contactId}`, { method: 'DELETE' })
      ))
      setContacts(contacts.filter(c => !selectedContacts.includes(c.id)))
      setSelectedContacts([])
      setDeleteContactConfirm(null)
      onContactsUpdated()
      const newTotalPages = Math.ceil((filteredContacts.length - selectedContacts.length) / contactsPerPage)
      if (currentPage > newTotalPages && newTotalPages > 0) setCurrentPage(newTotalPages)
    } catch {
      setDeleteContactConfirm(null)
      onError({ title: 'Error', message: 'An unexpected error occurred while deleting contacts.' })
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
        setContacts(contacts.map(c => c.id === contactId ? { ...c, ...updates } : c))
        setEditingContact(null)
      } else {
        onError({ title: 'Failed to Update Contact', message: data.error || 'An error occurred.' })
      }
    } catch {
      onError({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{list.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImportCsv(true)}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <i className="fas fa-file-csv mr-1.5 text-xs"></i>
              Import CSV
            </button>
            <button
              onClick={() => setShowAddContact(true)}
              className="px-3 py-1.5 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors"
            >
              <i className="fas fa-user-plus mr-1.5 text-xs"></i>
              Add Contact
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 ml-1">
              <i className="fas fa-times text-sm"></i>
            </button>
          </div>
        </div>

        {/* Search & bulk actions */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
            <input
              type="text"
              placeholder="Search contacts…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
            />
          </div>
          {selectedContacts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{selectedContacts.length} selected</span>
              <button
                onClick={() => setDeleteContactConfirm({ multiple: true })}
                className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
              >
                <i className="fas fa-trash mr-1"></i>
                Delete Selected
              </button>
            </div>
          )}
        </div>

        {/* Contacts Table */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <i className="fas fa-spinner fa-spin text-2xl text-gray-400 mb-3"></i>
                <p className="text-sm text-gray-500">Loading contacts…</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                      <th className="px-5 py-3 text-left">
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-[#C54A3F] border-gray-300 rounded"
                          checked={selectedContacts.length === currentContacts.length && currentContacts.length > 0}
                          onChange={selectAllContacts}
                        />
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Business</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Location</th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentContacts.map((contact) => (
                      <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-[#C54A3F] border-gray-300 rounded"
                            checked={selectedContacts.includes(contact.id)}
                            onChange={() => toggleContactSelection(contact.id)}
                          />
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <input
                              type="text"
                              value={editingContact.business_name}
                              onChange={(e) => setEditingContact({ ...editingContact, business_name: e.target.value })}
                              className="px-3 py-1.5 border border-[#C54A3F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F]"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 bg-[#C54A3F] rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {contact.business_name.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm font-medium text-gray-900">{contact.business_name}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <input
                              type="tel"
                              value={editingContact.phone_number}
                              onChange={(e) => setEditingContact({ ...editingContact, phone_number: e.target.value })}
                              className="px-3 py-1.5 border border-[#C54A3F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F]"
                            />
                          ) : (
                            <span className="text-sm text-gray-600">{formatPhoneNumber(contact.phone_number)}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <input
                              type="email"
                              value={editingContact.email || ''}
                              onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })}
                              className="px-3 py-1.5 border border-[#C54A3F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F]"
                            />
                          ) : (
                            <span className="text-sm text-gray-600">{contact.email || '—'}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-sm text-gray-600">
                            {[contact.city, contact.state, contact.country].filter(Boolean).join(', ') || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {editingContact?.id === contact.id ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => updateContact(contact.id, {
                                  business_name: editingContact.business_name,
                                  phone_number: editingContact.phone_number,
                                  email: editingContact.email
                                })}
                                className="px-2.5 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingContact(null)}
                                className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setEditingContact({ ...contact })}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                                title="Edit contact"
                              >
                                <i className="fas fa-pen text-[11px]"></i>
                              </button>
                              <button
                                onClick={() => setDeleteContactConfirm(contact)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete contact"
                              >
                                <i className="fas fa-trash-alt text-[11px]"></i>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}

                    {currentContacts.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-5 py-10 text-center">
                          <p className="text-sm text-gray-500">No contacts found</p>
                          <p className="text-xs text-gray-400 mt-1">Add contacts or import from CSV to get started</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50 flex-shrink-0">
                  <p className="text-xs text-gray-500">
                    {startIndex + 1}–{Math.min(endIndex, filteredContacts.length)} of {filteredContacts.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-left"></i>
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let pageNum
                      if (totalPages <= 5) pageNum = i + 1
                      else if (currentPage <= 3) pageNum = i + 1
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i
                      else pageNum = currentPage - 2 + i
                      return (
                        <button
                          key={pageNum}
                          onClick={() => goToPage(pageNum)}
                          className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                            currentPage === pageNum
                              ? 'bg-[#C54A3F] text-white border-[#C54A3F]'
                              : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-right"></i>
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
            onContactAdded={() => { fetchContacts(); onContactsUpdated() }}
            onError={onError}
          />
        )}

        {showImportCsv && (
          <ImportCsvModal
            onClose={() => setShowImportCsv(false)}
            contactListId={list.id}
            onImportComplete={() => { fetchContacts(); onContactsUpdated() }}
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

function AddContactModal({ onClose, contactListId, onContactAdded, onError }) {
  const [formData, setFormData] = useState({
    business_name: '', phone_number: '', email: '', city: '', state: '', country: '',
    contact_list_id: contactListId
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await apiPost('/api/contacts', formData)
      const data = await response.json()
      if (data.success) { onContactAdded(); onClose() }
      else { onClose(); onError({ title: 'Failed to Add Contact', message: data.error || 'An error occurred.' }) }
    } catch {
      onClose(); onError({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Add Contact</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Business Name *</label>
            <input
              type="text" required
              value={formData.business_name}
              onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              placeholder="Acme Corp"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone Number *</label>
            <input
              type="tel" required
              value={formData.phone_number}
              onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              placeholder="john@example.com"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'city', label: 'City', placeholder: 'New York' },
              { key: 'state', label: 'State', placeholder: 'NY' },
              { key: 'country', label: 'Country', placeholder: 'US' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
                <input
                  type="text"
                  value={formData[key]}
                  onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
            <button
              type="submit" disabled={loading}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50"
            >
              {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Adding…</> : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ImportCsvModal({ onClose, contactListId, onImportComplete, onError }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file && file.type === 'text/csv') { setSelectedFile(file); setResult(null) }
  }

  const handleImport = async () => {
    if (!selectedFile) return
    setLoading(true)
    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('contact_list_id', contactListId)
    try {
      const response = await fetchWithWorkspace('/api/contacts/import', { method: 'POST', body: formData, headers: {} })
      const data = await response.json()
      if (data.success) {
        setResult(data)
        onImportComplete()
        setTimeout(() => onClose(), 3000)
      } else {
        setResult({ error: data.error, details: data.details })
      }
    } catch (error) {
      setResult({ error: 'Import failed', details: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Import CSV</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {result ? (
            <div className={`p-4 rounded-md border ${result.error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              {result.error ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <i className="fas fa-times-circle text-red-600"></i>
                    <p className="text-sm font-medium text-red-900">Import Failed</p>
                  </div>
                  <p className="text-xs text-red-700">{result.error}</p>
                  {result.details && <p className="text-xs text-red-600 font-mono bg-red-100 px-2 py-1 rounded mt-2">{result.details}</p>}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <i className="fas fa-check-circle text-green-600"></i>
                    <p className="text-sm font-medium text-green-900">Import Successful</p>
                  </div>
                  <p className="text-xs text-green-700 mb-2">{result.message}</p>
                  <div className="space-y-0.5 text-xs text-green-700">
                    <p><i className="fas fa-check mr-1.5"></i>Imported: {result.imported}</p>
                    {result.duplicates > 0 && <p><i className="fas fa-ban mr-1.5"></i>Duplicates skipped: {result.duplicates}</p>}
                    {result.errors > 0 && <p><i className="fas fa-exclamation-triangle mr-1.5"></i>Parse errors: {result.errors}</p>}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">CSV File</label>
                <input
                  type="file" accept=".csv"
                  onChange={handleFileSelect}
                  className="w-full px-3 py-2 border-2 border-dashed border-gray-200 rounded-md text-sm focus:outline-none hover:border-[#C54A3F] cursor-pointer"
                />
                <div className="mt-2 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                  <p className="text-xs text-blue-700 font-medium mb-0.5">CSV Format:</p>
                  <p className="text-xs text-blue-600">Headers: business_name, phone, email, city, state, country</p>
                </div>
              </div>

              {selectedFile && (
                <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-md px-3 py-2.5">
                  <i className="fas fa-file-csv text-green-600 text-xl"></i>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                    <p className="text-xs text-gray-400">{(selectedFile.size / 1024).toFixed(2)} KB</p>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">
              {result?.success ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleImport}
                disabled={!selectedFile || loading}
                className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50"
              >
                {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Importing…</> : 'Import'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteContactConfirmModal({ contact, selectedCount, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)
  const isMultiple = contact.multiple && selectedCount > 0

  const handleConfirm = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Delete Contact{isMultiple ? 's' : ''}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">
            {isMultiple
              ? <>Delete <span className="font-medium text-red-600">{selectedCount} contacts</span>? This cannot be undone.</>
              : <>Delete <span className="font-medium text-gray-900">"{contact.business_name}"</span>? This cannot be undone.</>
            }
          </p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button onClick={handleConfirm} disabled={loading} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50">
            {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Deleting…</> : `Delete${isMultiple ? ` ${selectedCount}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
