'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

// Helper: derive display name from a contact
function contactDisplayName(contact) {
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
  return full || contact.business_name || contact.phone_number || '—'
}

function contactInitial(contact) {
  if (contact.first_name) return contact.first_name.charAt(0).toUpperCase()
  if (contact.business_name) return contact.business_name.charAt(0).toUpperCase()
  return '#'
}

export default function ContactsPage() {
  const [tab, setTab] = useState('all') // 'all' | 'lists'
  const [contactLists, setContactLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddList, setShowAddList] = useState(false)
  const [showViewContacts, setShowViewContacts] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [selectedList, setSelectedList] = useState(null)
  const [editingList, setEditingList] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [user, setUser] = useState(null)
  const [errorModal, setErrorModal] = useState(null)

  // All contacts tab
  const [allContacts, setAllContacts] = useState([])
  const [allContactsLoading, setAllContactsLoading] = useState(false)
  const [allSearchTerm, setAllSearchTerm] = useState('')
  const [allCurrentPage, setAllCurrentPage] = useState(1)
  const [editingContact, setEditingContact] = useState(null)
  const [deleteContactConfirm, setDeleteContactConfirm] = useState(null)
  const [selectedContacts, setSelectedContacts] = useState([])
  const [showImportCsv, setShowImportCsv] = useState(false)

  const contactsPerPage = 20
  const itemsPerPage = 10
  const [currentPage, setCurrentPage] = useState(1)

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

  const fetchAllContacts = useCallback(async () => {
    try {
      setAllContactsLoading(true)
      const response = await fetchWithWorkspace('/api/contacts')
      const data = await response.json()
      if (data.success) setAllContacts(data.contacts)
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setAllContactsLoading(false)
    }
  }, [])

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    fetchContactLists()
  }, [fetchContactLists])

  useEffect(() => {
    if (tab === 'all' && allContacts.length === 0) {
      fetchAllContacts()
    }
  }, [tab, allContacts.length, fetchAllContacts])

  const filteredLists = useMemo(() =>
    contactLists.filter(list =>
      list.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      list.description?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [contactLists, searchTerm]
  )

  const filteredAllContacts = useMemo(() =>
    allContacts.filter(c => {
      const q = allSearchTerm.toLowerCase()
      return !q || contactDisplayName(c).toLowerCase().includes(q) ||
        c.phone_number?.includes(q) || c.email?.toLowerCase().includes(q)
    }),
    [allContacts, allSearchTerm]
  )

  const totalListPages = Math.ceil(filteredLists.length / itemsPerPage)
  const listStart = (currentPage - 1) * itemsPerPage
  const currentLists = filteredLists.slice(listStart, listStart + itemsPerPage)

  const totalAllPages = Math.ceil(filteredAllContacts.length / contactsPerPage)
  const allStart = (allCurrentPage - 1) * contactsPerPage
  const currentAllContacts = filteredAllContacts.slice(allStart, allStart + contactsPerPage)

  useEffect(() => { setCurrentPage(1) }, [searchTerm])
  useEffect(() => { setAllCurrentPage(1) }, [allSearchTerm])

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

  const updateContact = async (contactId, updates) => {
    try {
      const response = await fetchWithWorkspace(`/api/contacts?id=${contactId}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
      })
      const data = await response.json()
      if (data.success) {
        setAllContacts(allContacts.map(c => c.id === contactId ? { ...c, ...updates } : c))
        setEditingContact(null)
      } else {
        setErrorModal({ title: 'Failed to Update Contact', message: data.error || 'An error occurred.' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    }
  }

  const deleteContact = async (contactId) => {
    try {
      const response = await fetchWithWorkspace(`/api/contacts?id=${contactId}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setAllContacts(allContacts.filter(c => c.id !== contactId))
        setSelectedContacts(selectedContacts.filter(id => id !== contactId))
        setDeleteContactConfirm(null)
      } else {
        setErrorModal({ title: 'Failed to Delete', message: data.error || 'An error occurred.' })
      }
    } catch {
      setErrorModal({ title: 'Error', message: 'An unexpected error occurred.' })
    }
  }

  const deleteSelectedContacts = async () => {
    try {
      await Promise.all(selectedContacts.map(id =>
        fetchWithWorkspace(`/api/contacts?id=${id}`, { method: 'DELETE' })
      ))
      setAllContacts(allContacts.filter(c => !selectedContacts.includes(c.id)))
      setSelectedContacts([])
      setDeleteContactConfirm(null)
    } catch {
      setErrorModal({ title: 'Error', message: 'An unexpected error occurred while deleting contacts.' })
    }
  }

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const d = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    return phone
  }

  const Pagination = ({ currentPage, totalPages, onPage }) => {
    if (totalPages <= 1) return null
    return (
      <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
        <p className="text-xs text-[#9B9890]">{(currentPage - 1) * contactsPerPage + 1}–{Math.min(currentPage * contactsPerPage, filteredAllContacts.length)} of {filteredAllContacts.length}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(currentPage - 1)} disabled={currentPage === 1} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-left"></i></button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let p = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i
            return <button key={p} onClick={() => onPage(p)} className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${currentPage === p ? 'bg-[#D63B1F] text-white border-[#D63B1F]' : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>{p}</button>
          })}
          <button onClick={() => onPage(currentPage + 1)} disabled={currentPage === totalPages} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-right"></i></button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-[#F7F6F3] flex flex-col overflow-auto">
      <div className="p-4 md:p-6 space-y-4">

        {/* Tabs — full width on mobile */}
        <div className="flex items-center gap-1 bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg p-1">
          {[
            { id: 'all', label: 'All Contacts', icon: 'fa-address-book' },
            { id: 'lists', label: 'Contact Lists', icon: 'fa-layer-group' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-[#D63B1F] text-white' : 'text-[#5C5A55] hover:bg-[#F7F6F3]'}`}
            >
              <i className={`fas ${t.icon} text-xs`}></i>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── LISTS TAB ── */}
        {tab === 'lists' && (
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
            {/* Header */}
            <div className="px-4 md:px-5 py-3 md:py-3.5 border-b border-[#E3E1DB]">
              {/* Mobile: two rows */}
              <div className="md:hidden space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#131210]">Contact Lists</h3>
                  <button onClick={() => setShowAddList(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0">
                    <i className="fas fa-plus text-xs"></i>New List
                  </button>
                </div>
                <div className="relative">
                  <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                  <input type="text" placeholder="Search lists…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
                </div>
              </div>
              {/* Desktop: single row (original layout) */}
              <div className="hidden md:flex md:items-center md:justify-between md:gap-4">
                <h3 className="text-sm font-semibold text-[#131210]">Contact Lists</h3>
                <div className="flex items-center gap-2">
                  <div className="relative max-w-xs w-60">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                    <input type="text" placeholder="Search lists…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
                  </div>
                  <button onClick={() => setShowAddList(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0">
                    <i className="fas fa-plus text-xs"></i>New List
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-[#9B9890]"><i className="fas fa-spinner fa-spin mr-2"></i>Loading…</div>
            ) : currentLists.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-[#9B9890]">No contact lists found</p>
                <p className="text-xs text-[#9B9890] mt-1">Create your first list to start organizing contacts</p>
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-[#E3E1DB]">
                  {currentLists.map((list) => (
                    <div key={list.id} className="px-4 py-3.5">
                      {editingList?.id === list.id ? (
                        <div className="space-y-2">
                          <input type="text" value={editingList.name} onChange={(e) => setEditingList({ ...editingList, name: e.target.value })}
                            className="w-full px-3 py-2 border border-[#D63B1F] rounded-md text-sm focus:outline-none" autoFocus placeholder="List name" />
                          <input type="text" value={editingList.description || ''} onChange={(e) => setEditingList({ ...editingList, description: e.target.value })}
                            className="w-full px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none" placeholder="Description (optional)" />
                          <div className="flex gap-2">
                            <button onClick={() => handleUpdateList(list.id, { name: editingList.name, description: editingList.description })} className="flex-1 py-2 text-xs font-medium text-white bg-[#D63B1F] rounded-md">Save</button>
                            <button onClick={() => setEditingList(null)} className="flex-1 py-2 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-md">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-[#D63B1F] rounded-lg flex items-center justify-center text-white text-sm font-semibold shrink-0">{list.name.charAt(0).toUpperCase()}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#131210]">{list.name}</p>
                            <p className="text-xs text-[#9B9890] truncate">{list.description || new Date(list.created_at).toLocaleDateString()}</p>
                          </div>
                          <span className="text-xs text-[#9B9890] shrink-0 flex items-center gap-1"><i className="fas fa-users text-[10px]"></i>{list.contactCount || 0}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => { setSelectedList(list); setShowViewContacts(true) }} className="p-2 text-[#9B9890] hover:text-[#5C5A55] rounded-lg" title="View"><i className="fas fa-address-book text-xs"></i></button>
                            <button onClick={() => setEditingList({ ...list })} className="p-2 text-[#9B9890] hover:text-[#5C5A55] rounded-lg" title="Rename"><i className="fas fa-pen text-xs"></i></button>
                            <button onClick={() => setDeleteConfirm(list)} className="p-2 text-[#9B9890] hover:text-[#D63B1F] rounded-lg" title="Delete"><i className="fas fa-trash-alt text-xs"></i></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">List Name</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Description</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Contacts</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Created</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3E1DB]">
                      {currentLists.map((list) => (
                        <tr key={list.id} className="hover:bg-[#F7F6F3] transition-colors">
                          <td className="px-5 py-3">
                            {editingList?.id === list.id ? (
                              <input type="text" value={editingList.name} onChange={(e) => setEditingList({ ...editingList, name: e.target.value })}
                                className="px-3 py-1.5 border border-[#D63B1F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] w-full max-w-xs" autoFocus />
                            ) : (
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 bg-[#D63B1F] rounded-md flex items-center justify-center text-white text-xs font-semibold shrink-0">{list.name.charAt(0).toUpperCase()}</div>
                                <span className="text-sm font-medium text-[#131210]">{list.name}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {editingList?.id === list.id ? (
                              <input type="text" value={editingList.description || ''} onChange={(e) => setEditingList({ ...editingList, description: e.target.value })} placeholder="Add description…"
                                className="px-3 py-1.5 border border-[#D63B1F] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] w-full max-w-md" />
                            ) : (
                              <span className="text-sm text-[#9B9890] line-clamp-1">{list.description || '—'}</span>
                            )}
                          </td>
                          <td className="px-5 py-3"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#EFEDE8] text-[#5C5A55]"><i className="fas fa-users mr-1 text-[10px]"></i>{list.contactCount || 0}</span></td>
                          <td className="px-5 py-3 text-sm text-[#9B9890] whitespace-nowrap">{new Date(list.created_at).toLocaleDateString()}</td>
                          <td className="px-5 py-3 text-right">
                            {editingList?.id === list.id ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => handleUpdateList(list.id, { name: editingList.name, description: editingList.description })} className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded hover:bg-[#c4351b]">Save</button>
                                <button onClick={() => setEditingList(null)} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3]">Cancel</button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => { setSelectedList(list); setShowViewContacts(true) }} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] transition-colors"><i className="fas fa-address-book text-[11px]"></i>View</button>
                                <button onClick={() => setEditingList({ ...list })} className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"><i className="fas fa-pen text-[11px]"></i></button>
                                <button onClick={() => setDeleteConfirm(list)} className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"><i className="fas fa-trash-alt text-[11px]"></i></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalListPages > 1 && (
                  <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
                    <p className="text-xs text-[#9B9890]">{listStart + 1}–{Math.min(listStart + itemsPerPage, filteredLists.length)} of {filteredLists.length}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-left"></i></button>
                      {Array.from({ length: totalListPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalListPages || Math.abs(p - currentPage) <= 1).map((p, idx, arr) => (
                        <div key={p} className="flex items-center">
                          {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1.5 text-[#9B9890] text-xs">…</span>}
                          <button onClick={() => setCurrentPage(p)} className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${currentPage === p ? 'bg-[#D63B1F] text-white border-[#D63B1F]' : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>{p}</button>
                        </div>
                      ))}
                      <button onClick={() => setCurrentPage(p => Math.min(totalListPages, p + 1))} disabled={currentPage === totalListPages} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-right"></i></button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── ALL CONTACTS TAB ── */}
        {tab === 'all' && (
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
            {/* Header */}
            <div data-tour="contacts-header" className="px-4 md:px-5 py-3 md:py-3.5 border-b border-[#E3E1DB]">
              {/* Mobile: two rows */}
              <div className="md:hidden space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#131210] shrink-0">All Contacts</h3>
                  <div className="flex items-center gap-2">
                    {selectedContacts.length > 0 && (
                      <button onClick={() => setDeleteContactConfirm({ multiple: true })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded-md">
                        <i className="fas fa-trash text-[10px]"></i>{selectedContacts.length}
                      </button>
                    )}
                    <button onClick={() => setShowImportCsv(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors whitespace-nowrap">
                      <i className="fas fa-file-csv text-xs"></i>Import
                    </button>
                    <button onClick={() => setShowAddContact(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap">
                      <i className="fas fa-user-plus text-xs"></i>Add
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                  <input type="text" placeholder="Search contacts…" value={allSearchTerm} onChange={(e) => setAllSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
                </div>
              </div>
              {/* Desktop: single row (original layout) */}
              <div className="hidden md:flex md:items-center md:justify-between md:gap-4">
                <h3 className="text-sm font-semibold text-[#131210] shrink-0">All Contacts</h3>
                <div className="flex items-center gap-2">
                  {selectedContacts.length > 0 && (
                    <button onClick={() => setDeleteContactConfirm({ multiple: true })} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded-md">
                      <i className="fas fa-trash text-[10px]"></i>Delete {selectedContacts.length}
                    </button>
                  )}
                  <div className="relative max-w-xs w-60">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
                    <input type="text" placeholder="Search contacts…" value={allSearchTerm} onChange={(e) => setAllSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
                  </div>
                  <button onClick={() => setShowImportCsv(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors whitespace-nowrap">
                    <i className="fas fa-file-csv text-xs"></i>Import CSV
                  </button>
                  <button onClick={() => setShowAddContact(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap">
                    <i className="fas fa-user-plus text-xs"></i>Add Contact
                  </button>
                </div>
              </div>
            </div>

            {allContactsLoading ? (
              <div className="px-5 py-8 text-center text-sm text-[#9B9890]"><i className="fas fa-spinner fa-spin mr-2"></i>Loading…</div>
            ) : (
              <>
                {/* Mobile contact cards */}
                <div className="md:hidden divide-y divide-[#E3E1DB]">
                  {currentAllContacts.length === 0 ? (
                    <div className="px-5 py-10 text-center"><p className="text-sm text-[#9B9890]">No contacts found</p><p className="text-xs text-[#9B9890] mt-1">Add contacts or import from CSV</p></div>
                  ) : currentAllContacts.map((contact) => (
                    <div key={contact.id} className="px-4 py-3.5">
                      {editingContact?.id === contact.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" value={editingContact.first_name || ''} onChange={(e) => setEditingContact({ ...editingContact, first_name: e.target.value })} placeholder="First name" className="px-3 py-2 border border-[#D63B1F] rounded-md text-sm focus:outline-none" autoFocus />
                            <input type="text" value={editingContact.last_name || ''} onChange={(e) => setEditingContact({ ...editingContact, last_name: e.target.value })} placeholder="Last name" className="px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none" />
                          </div>
                          <input type="text" value={editingContact.business_name || ''} onChange={(e) => setEditingContact({ ...editingContact, business_name: e.target.value })} placeholder="Company" className="w-full px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none" />
                          <input type="tel" value={editingContact.phone_number || ''} onChange={(e) => setEditingContact({ ...editingContact, phone_number: e.target.value })} placeholder="Phone" className="w-full px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none" />
                          <input type="email" value={editingContact.email || ''} onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })} placeholder="Email" className="w-full px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none" />
                          <div className="flex gap-2 pt-1">
                            <button onClick={() => updateContact(contact.id, { first_name: editingContact.first_name, last_name: editingContact.last_name, business_name: editingContact.business_name, phone_number: editingContact.phone_number, email: editingContact.email })}
                              className="flex-1 py-2 text-xs font-medium text-white bg-[#D63B1F] rounded-md">Save</button>
                            <button onClick={() => setEditingContact(null)} className="flex-1 py-2 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-md">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <input type="checkbox" className="w-4 h-4 text-[#D63B1F] border-[#D4D1C9] rounded shrink-0"
                            checked={selectedContacts.includes(contact.id)}
                            onChange={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(id => id !== contact.id) : [...prev, contact.id])} />
                          <div className="w-9 h-9 bg-[#D63B1F] rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0">{contactInitial(contact)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#131210] truncate">{contactDisplayName(contact)}</p>
                            <p className="text-xs text-[#9B9890] truncate">{formatPhoneNumber(contact.phone_number)}{contact.email ? ` · ${contact.email}` : ''}</p>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => setEditingContact({ ...contact })} className="p-2 text-[#9B9890] hover:text-[#5C5A55] rounded-lg"><i className="fas fa-pen text-xs"></i></button>
                            <button onClick={() => setDeleteContactConfirm(contact)} className="p-2 text-[#9B9890] hover:text-[#D63B1F] rounded-lg"><i className="fas fa-trash-alt text-xs"></i></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                        <th className="px-5 py-3 text-left">
                          <input type="checkbox" className="w-4 h-4 text-[#D63B1F] border-[#D4D1C9] rounded"
                            checked={selectedContacts.length === currentAllContacts.length && currentAllContacts.length > 0}
                            onChange={() => setSelectedContacts(prev => prev.length === currentAllContacts.length ? [] : currentAllContacts.map(c => c.id))} />
                        </th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Name</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Company</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Phone</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Email</th>
                        <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">List</th>
                        <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3E1DB]">
                      {currentAllContacts.map((contact) => (
                        <tr key={contact.id} className="hover:bg-[#F7F6F3] transition-colors">
                          <td className="px-5 py-3"><input type="checkbox" className="w-4 h-4 text-[#D63B1F] border-[#D4D1C9] rounded" checked={selectedContacts.includes(contact.id)} onChange={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(id => id !== contact.id) : [...prev, contact.id])} /></td>
                          <td className="px-5 py-3">
                            {editingContact?.id === contact.id ? (
                              <div className="flex gap-1">
                                <input type="text" value={editingContact.first_name || ''} onChange={(e) => setEditingContact({ ...editingContact, first_name: e.target.value })} placeholder="First" className="px-2 py-1.5 border border-[#D63B1F] rounded-md text-sm w-24 focus:outline-none" autoFocus />
                                <input type="text" value={editingContact.last_name || ''} onChange={(e) => setEditingContact({ ...editingContact, last_name: e.target.value })} placeholder="Last" className="px-2 py-1.5 border border-[#D63B1F] rounded-md text-sm w-24 focus:outline-none" />
                              </div>
                            ) : (
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 bg-[#D63B1F] rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0">{contactInitial(contact)}</div>
                                <span className="text-sm font-medium text-[#131210]">{[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3">{editingContact?.id === contact.id ? <input type="text" value={editingContact.business_name || ''} onChange={(e) => setEditingContact({ ...editingContact, business_name: e.target.value })} placeholder="Company" className="px-2 py-1.5 border border-[#D63B1F] rounded-md text-sm w-32 focus:outline-none" /> : <span className="text-sm text-[#9B9890]">{contact.business_name || '—'}</span>}</td>
                          <td className="px-5 py-3">{editingContact?.id === contact.id ? <input type="tel" value={editingContact.phone_number || ''} onChange={(e) => setEditingContact({ ...editingContact, phone_number: e.target.value })} className="px-2 py-1.5 border border-[#D63B1F] rounded-md text-sm w-36 focus:outline-none" /> : <span className="text-sm text-[#5C5A55]">{formatPhoneNumber(contact.phone_number)}</span>}</td>
                          <td className="px-5 py-3">{editingContact?.id === contact.id ? <input type="email" value={editingContact.email || ''} onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })} className="px-2 py-1.5 border border-[#D63B1F] rounded-md text-sm w-40 focus:outline-none" /> : <span className="text-sm text-[#5C5A55]">{contact.email || '—'}</span>}</td>
                          <td className="px-5 py-3"><span className="text-xs text-[#9B9890]">{contact.contact_lists?.name || '—'}</span></td>
                          <td className="px-5 py-3 text-right">
                            {editingContact?.id === contact.id ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => updateContact(contact.id, { first_name: editingContact.first_name, last_name: editingContact.last_name, business_name: editingContact.business_name, phone_number: editingContact.phone_number, email: editingContact.email })} className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded hover:bg-[#c4351b]">Save</button>
                                <button onClick={() => setEditingContact(null)} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3]">Cancel</button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => setEditingContact({ ...contact })} className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors"><i className="fas fa-pen text-[11px]"></i></button>
                                <button onClick={() => setDeleteContactConfirm(contact)} className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors"><i className="fas fa-trash-alt text-[11px]"></i></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {currentAllContacts.length === 0 && (
                        <tr><td colSpan="7" className="px-5 py-10 text-center"><p className="text-sm text-[#9B9890]">No contacts found</p><p className="text-xs text-[#9B9890] mt-1">Add contacts or import from CSV</p></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination currentPage={allCurrentPage} totalPages={totalAllPages} onPage={setAllCurrentPage} />
              </>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddList && <AddListModal onClose={() => setShowAddList(false)} onListAdded={fetchContactLists} onError={(e) => setErrorModal(e)} />}

      {showViewContacts && selectedList && (
        <ViewContactsModal
          list={selectedList}
          onClose={() => { setShowViewContacts(false); setSelectedList(null) }}
          onContactsUpdated={fetchContactLists}
          onError={(e) => setErrorModal(e)}
        />
      )}

      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          contactListId={null}
          onContactAdded={() => { fetchAllContacts(); fetchContactLists() }}
          onError={(e) => setErrorModal(e)}
        />
      )}

      {showImportCsv && (
        <ImportCsvModal
          onClose={() => setShowImportCsv(false)}
          contactListId={null}
          onImportComplete={() => fetchAllContacts()}
          onError={(e) => setErrorModal(e)}
        />
      )}

      {deleteConfirm && (
        <DeleteConfirmModal list={deleteConfirm} onConfirm={() => handleDeleteList(deleteConfirm.id)} onCancel={() => setDeleteConfirm(null)} />
      )}

      {deleteContactConfirm && (
        <DeleteContactConfirmModal
          contact={deleteContactConfirm}
          selectedCount={selectedContacts.length}
          onConfirm={deleteContactConfirm.multiple ? deleteSelectedContacts : () => deleteContact(deleteContactConfirm.id)}
          onCancel={() => setDeleteContactConfirm(null)}
        />
      )}

      {errorModal && <ErrorModal title={errorModal.title} message={errorModal.message} onClose={() => setErrorModal(null)} />}
    </div>
  )
}

function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">{title}</h3></div>
        <div className="px-5 py-4"><p className="text-sm text-[#5C5A55]">{message}</p></div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">OK</button>
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
    } catch { onClose(); onError({ title: 'Error', message: 'An unexpected error occurred.' }) }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">New Contact List</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">List Name *</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" placeholder="e.g., Marketing Prospects 2025" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] resize-none" rows={3} placeholder="Add a description…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
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
  const handleConfirm = async () => { setLoading(true); await onConfirm(); setLoading(false) }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">Delete Contact List</h3></div>
        <div className="px-5 py-4">
          <p className="text-sm text-[#5C5A55]">Delete <span className="font-medium text-[#131210]">"{list.name}"</span>? This cannot be undone.
            {list.contactCount > 0 && <span className="block mt-1.5 text-xs text-[#D63B1F]"><i className="fas fa-exclamation-circle mr-1"></i>This will also delete {list.contactCount} contact{list.contactCount !== 1 ? 's' : ''}.</span>}
          </p>
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] disabled:opacity-50">Cancel</button>
          <button onClick={handleConfirm} disabled={loading} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c4351b] rounded-md disabled:opacity-50">
            {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Deleting…</> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteContactConfirmModal({ contact, selectedCount, onConfirm, onCancel }) {
  const [loading, setLoading] = useState(false)
  const handleConfirm = async () => { setLoading(true); await onConfirm(); setLoading(false) }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">Delete Contact{contact.multiple ? 's' : ''}</h3></div>
        <div className="px-5 py-4">
          <p className="text-sm text-[#5C5A55]">
            {contact.multiple ? `Delete ${selectedCount} selected contacts?` : `Delete this contact? This cannot be undone.`}
          </p>
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] disabled:opacity-50">Cancel</button>
          <button onClick={handleConfirm} disabled={loading} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c4351b] rounded-md disabled:opacity-50">
            {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Deleting…</> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddContactModal({ onClose, contactListId, onContactAdded, onError }) {
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', business_name: '', phone_number: '', email: '',
    city: '', state: '', country: '', contact_list_id: contactListId
  })
  const [loading, setLoading] = useState(false)

  const set = (key, val) => setFormData(f => ({ ...f, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await fetchWithWorkspace('/api/contacts', { method: 'POST', body: JSON.stringify(formData) })
      const data = await response.json()
      if (data.success) { onContactAdded(); onClose() }
      else { onClose(); onError({ title: 'Failed to Add Contact', message: data.error || 'An error occurred.' }) }
    } catch { onClose(); onError({ title: 'Error', message: 'An unexpected error occurred.' }) }
    finally { setLoading(false) }
  }

  const inputClass = "w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">Add Contact</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">First Name</label>
              <input type="text" value={formData.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputClass} placeholder="Jane" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Last Name</label>
              <input type="text" value={formData.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputClass} placeholder="Doe" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Company Name</label>
            <input type="text" value={formData.business_name} onChange={(e) => set('business_name', e.target.value)} className={inputClass} placeholder="Acme Corp (optional)" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Phone Number *</label>
            <input type="tel" required value={formData.phone_number} onChange={(e) => set('phone_number', e.target.value)} className={inputClass} placeholder="+1 (555) 123-4567" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Email</label>
            <input type="email" value={formData.email} onChange={(e) => set('email', e.target.value)} className={inputClass} placeholder="jane@example.com" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[['city', 'City', 'New York'], ['state', 'State', 'NY'], ['country', 'Country', 'US']].map(([key, label, ph]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">{label}</label>
                <input type="text" value={formData[key]} onChange={(e) => set(key, e.target.value)} className={inputClass} placeholder={ph} />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
              {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Adding…</> : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const STANDARD_FIELD_OPTIONS = [
  { value: 'skip', label: '— Skip —' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'business_name', label: 'Company Name' },
  { value: 'phone_number', label: 'Phone Number *' },
  { value: 'email', label: 'Email' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'country', label: 'Country' },
]

function parseCSVHeaders(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < lines[0].length; i++) {
    const c = lines[0][i]
    if (c === '"') { inQuotes = !inQuotes }
    else if (c === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += c }
  }
  result.push(current.trim())
  return result
}

function autoDetectField(header) {
  const h = header.toLowerCase().trim()
  if (h === 'firstname' || h === 'first_name' || h === 'first name') return 'first_name'
  if (h === 'lastname' || h === 'last_name' || h === 'last name') return 'last_name'
  if ((h.includes('business') && h.includes('name')) || h === 'company' || h === 'company name') return 'business_name'
  if (h === 'phone_number_1' || h === 'phone_number' || h === 'phone_1' || h.includes('phone')) return 'phone_number'
  if (h === 'email_1' || h === 'email') return 'email'
  if (h.includes('city')) return 'city'
  if (h.includes('state')) return 'state'
  if (h.includes('country')) return 'country'
  return 'skip'
}

function ImportCsvModal({ onClose, contactListId, onImportComplete, onError, listColumns = [] }) {
  const [step, setStep] = useState(1) // 1=file select, 2=map columns
  const [selectedFile, setSelectedFile] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [fieldMapping, setFieldMapping] = useState({}) // { header: fieldValue }
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleFileSelect = async (event) => {
    const file = event.target.files[0]
    if (!file) return
    setSelectedFile(file)
    setResult(null)
    const text = await file.text()
    const headers = parseCSVHeaders(text)
    setCsvHeaders(headers)
    // Auto-detect field mappings
    const auto = {}
    headers.forEach(h => { auto[h] = autoDetectField(h) })
    setFieldMapping(auto)
    setStep(2)
  }

  const customColumnOptions = listColumns.map(col => ({
    value: `custom:${col.key}`,
    label: `Custom: ${col.label}`
  }))

  const allOptions = [...STANDARD_FIELD_OPTIONS, ...customColumnOptions]

  const handleImport = async () => {
    setLoading(true)
    const fd = new FormData()
    fd.append('file', selectedFile)
    if (contactListId) fd.append('contact_list_id', contactListId)
    fd.append('column_mapping', JSON.stringify(fieldMapping))
    try {
      const response = await fetchWithWorkspace('/api/contacts/import', { method: 'POST', body: fd, headers: {} })
      const data = await response.json()
      if (data.success) { setResult(data); onImportComplete(); setTimeout(() => onClose(), 3000) }
      else { setResult({ error: data.error }) }
    } catch (error) {
      setResult({ error: 'Import failed: ' + error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Import CSV</h3>
            {step === 2 && <p className="text-xs text-[#9B9890] mt-0.5">Map columns to fields</p>}
          </div>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {result ? (
            <div className={`p-4 rounded-md border ${result.error ? 'bg-[rgba(214,59,31,0.07)] border-[rgba(214,59,31,0.14)]' : 'bg-[rgba(34,197,94,0.07)] border-[rgba(34,197,94,0.15)]'}`}>
              {result.error ? (
                <p className="text-sm text-[#D63B1F]"><i className="fas fa-exclamation-circle mr-2"></i>{result.error}</p>
              ) : (
                <div>
                  <p className="text-sm font-medium text-[#16a34a]"><i className="fas fa-check-circle mr-2"></i>Import complete!</p>
                  <p className="text-xs text-[#16a34a] mt-1">{result.message}</p>
                </div>
              )}
            </div>
          ) : step === 1 ? (
            <>
              <p className="text-xs text-[#9B9890]">Upload a CSV file. You'll be able to map each column to a contact field on the next step.</p>
              <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-[#D4D1C9] rounded-lg cursor-pointer hover:border-[#D63B1F] transition-colors">
                <i className="fas fa-file-csv text-2xl text-[#9B9890]"></i>
                <p className="text-sm text-[#9B9890]">Click to select a CSV file</p>
                <input type="file" accept=".csv,text/csv" onChange={handleFileSelect} className="hidden" />
              </label>
              <div className="flex justify-end">
                <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[#9B9890]">File: <strong>{selectedFile?.name}</strong> — {csvHeaders.length} columns detected. Map each CSV column to a contact field.</p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {csvHeaders.map(header => (
                  <div key={header} className="flex items-center gap-3">
                    <span className="text-xs font-mono bg-[#F7F6F3] border border-[#E3E1DB] rounded px-2 py-1 flex-1 truncate">{header}</span>
                    <i className="fas fa-arrow-right text-[#9B9890] text-xs flex-shrink-0"></i>
                    <select
                      value={fieldMapping[header] || 'skip'}
                      onChange={e => setFieldMapping(m => ({ ...m, [header]: e.target.value }))}
                      className="flex-1 px-2 py-1.5 text-xs border border-[#D4D1C9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#D63B1F]"
                    >
                      {allOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-2 pt-1">
                <button onClick={() => setStep(1)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                  <i className="fas fa-arrow-left mr-1.5 text-xs"></i>Back
                </button>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
                  <button onClick={handleImport} disabled={loading} className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
                    {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Importing…</> : 'Import'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ViewContactsModal({ list, onClose, onContactsUpdated, onError }) {
  const [contacts, setContacts] = useState([])
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddContact, setShowAddContact] = useState(false)
  const [showImportCsv, setShowImportCsv] = useState(false)
  const [showManageColumns, setShowManageColumns] = useState(false)
  const [selectedContacts, setSelectedContacts] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [editingContact, setEditingContact] = useState(null)
  const [deleteContactConfirm, setDeleteContactConfirm] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const contactsPerPage = 10

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetchWithWorkspace(`/api/contacts?contact_list_id=${list.id}`)
      const data = await response.json()
      if (data.success) setContacts(data.contacts)
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setLoading(false)
    }
  }, [list.id])

  const fetchColumns = useCallback(async () => {
    try {
      const response = await fetchWithWorkspace(`/api/contact-lists/${list.id}/columns`)
      const data = await response.json()
      if (data.success) setColumns(data.columns || [])
    } catch (error) {
      console.error('Error fetching columns:', error)
    }
  }, [list.id])

  useEffect(() => { fetchContacts(); fetchColumns() }, [fetchContacts, fetchColumns])

  const filteredContacts = useMemo(() =>
    contacts.filter(c => {
      const q = searchTerm.toLowerCase()
      return !q || contactDisplayName(c).toLowerCase().includes(q) ||
        c.phone_number?.includes(q) || c.email?.toLowerCase().includes(q)
    }),
    [contacts, searchTerm]
  )

  const totalPages = Math.ceil(filteredContacts.length / contactsPerPage)
  const startIndex = (currentPage - 1) * contactsPerPage
  const currentContacts = filteredContacts.slice(startIndex, startIndex + contactsPerPage)

  useEffect(() => { setCurrentPage(1) }, [searchTerm])

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const d = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    return phone
  }

  const deleteContact = async (contactId) => {
    try {
      const response = await fetchWithWorkspace(`/api/contacts?id=${contactId}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setContacts(contacts.filter(c => c.id !== contactId))
        setSelectedContacts(selectedContacts.filter(id => id !== contactId))
        setDeleteContactConfirm(null)
        onContactsUpdated()
      } else {
        setDeleteContactConfirm(null)
        onError({ title: 'Failed to Delete Contact', message: data.error || 'An error occurred.' })
      }
    } catch { setDeleteContactConfirm(null); onError({ title: 'Error', message: 'An unexpected error occurred.' }) }
  }

  const deleteSelectedContacts = async () => {
    try {
      await Promise.all(selectedContacts.map(id => fetchWithWorkspace(`/api/contacts?id=${id}`, { method: 'DELETE' })))
      setContacts(contacts.filter(c => !selectedContacts.includes(c.id)))
      setSelectedContacts([])
      setDeleteContactConfirm(null)
      onContactsUpdated()
    } catch { setDeleteContactConfirm(null); onError({ title: 'Error', message: 'An unexpected error occurred.' }) }
  }

  const updateContact = async (contactId, updates) => {
    try {
      const response = await fetchWithWorkspace(`/api/contacts?id=${contactId}`, { method: 'PUT', body: JSON.stringify(updates) })
      const data = await response.json()
      if (data.success) { setContacts(contacts.map(c => c.id === contactId ? { ...c, ...updates } : c)); setEditingContact(null) }
      else { onError({ title: 'Failed to Update Contact', message: data.error || 'An error occurred.' }) }
    } catch { onError({ title: 'Error', message: 'An unexpected error occurred.' }) }
  }

  const inputClass = "px-2 py-1.5 border border-[#D63B1F] rounded-md text-sm focus:outline-none"

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB] flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">{list.name}</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">{filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowManageColumns(true)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors" title="Manage custom columns">
              <i className="fas fa-columns mr-1.5 text-xs"></i>Columns
            </button>
            <button onClick={() => setShowImportCsv(true)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors">
              <i className="fas fa-file-csv mr-1.5 text-xs"></i>Import CSV
            </button>
            <button onClick={() => setShowAddContact(true)} className="px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors">
              <i className="fas fa-user-plus mr-1.5 text-xs"></i>Add Contact
            </button>
            <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1 ml-1"><i className="fas fa-times text-sm"></i></button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-[#E3E1DB] flex-shrink-0 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9890] text-xs"></i>
            <input type="text" placeholder="Search contacts…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]" />
          </div>
          {selectedContacts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#9B9890]">{selectedContacts.length} selected</span>
              <button onClick={() => setDeleteContactConfirm({ multiple: true })} className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded hover:bg-[#c4351b]">
                <i className="fas fa-trash mr-1"></i>Delete Selected
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center"><i className="fas fa-spinner fa-spin text-2xl text-[#9B9890] mb-3"></i><p className="text-sm text-[#9B9890]">Loading contacts…</p></div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB] sticky top-0 z-10">
                      <th className="px-5 py-3 text-left">
                        <input type="checkbox" className="w-4 h-4 text-[#D63B1F] border-[#D4D1C9] rounded"
                          checked={selectedContacts.length === currentContacts.length && currentContacts.length > 0}
                          onChange={() => setSelectedContacts(prev => prev.length === currentContacts.length ? [] : currentContacts.map(c => c.id))} />
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Name</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Company</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Phone</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Email</th>
                      {columns.map(col => (
                        <th key={col.key} className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">{col.label}</th>
                      ))}
                      <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E1DB]">
                    {currentContacts.map((contact) => (
                      <tr key={contact.id} className="hover:bg-[#F7F6F3] transition-colors">
                        <td className="px-5 py-3">
                          <input type="checkbox" className="w-4 h-4 text-[#D63B1F] border-[#D4D1C9] rounded"
                            checked={selectedContacts.includes(contact.id)}
                            onChange={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(id => id !== contact.id) : [...prev, contact.id])} />
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <div className="flex gap-1">
                              <input type="text" value={editingContact.first_name || ''} onChange={(e) => setEditingContact({ ...editingContact, first_name: e.target.value })} placeholder="First" className={`${inputClass} w-24`} autoFocus />
                              <input type="text" value={editingContact.last_name || ''} onChange={(e) => setEditingContact({ ...editingContact, last_name: e.target.value })} placeholder="Last" className={`${inputClass} w-24`} />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 bg-[#D63B1F] rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">{contactInitial(contact)}</div>
                              <span className="text-sm font-medium text-[#131210]">{[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <input type="text" value={editingContact.business_name || ''} onChange={(e) => setEditingContact({ ...editingContact, business_name: e.target.value })} placeholder="Company" className={`${inputClass} w-32`} />
                          ) : (
                            <span className="text-sm text-[#9B9890]">{contact.business_name || '—'}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <input type="tel" value={editingContact.phone_number || ''} onChange={(e) => setEditingContact({ ...editingContact, phone_number: e.target.value })} className={`${inputClass} w-36`} />
                          ) : (
                            <span className="text-sm text-[#5C5A55]">{formatPhoneNumber(contact.phone_number)}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {editingContact?.id === contact.id ? (
                            <input type="email" value={editingContact.email || ''} onChange={(e) => setEditingContact({ ...editingContact, email: e.target.value })} className={`${inputClass} w-40`} />
                          ) : (
                            <span className="text-sm text-[#5C5A55]">{contact.email || '—'}</span>
                          )}
                        </td>
                        {columns.map(col => (
                          <td key={col.key} className="px-5 py-3">
                            {editingContact?.id === contact.id ? (
                              <input
                                type="text"
                                value={editingContact.custom_fields?.[col.key] || ''}
                                onChange={(e) => setEditingContact(prev => ({
                                  ...prev,
                                  custom_fields: { ...(prev.custom_fields || {}), [col.key]: e.target.value }
                                }))}
                                placeholder={col.label}
                                className={`${inputClass} w-28`}
                              />
                            ) : (
                              <span className="text-sm text-[#5C5A55]">{contact.custom_fields?.[col.key] || '—'}</span>
                            )}
                          </td>
                        ))}
                        <td className="px-5 py-3 text-right">
                          {editingContact?.id === contact.id ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => updateContact(contact.id, { first_name: editingContact.first_name, last_name: editingContact.last_name, business_name: editingContact.business_name, phone_number: editingContact.phone_number, email: editingContact.email, custom_fields: editingContact.custom_fields })}
                                className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded hover:bg-[#c4351b]">Save</button>
                              <button onClick={() => setEditingContact(null)} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3]">Cancel</button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setEditingContact({ ...contact, custom_fields: { ...(contact.custom_fields || {}) } })} className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded transition-colors" title="Edit"><i className="fas fa-pen text-[11px]"></i></button>
                              <button onClick={() => setDeleteContactConfirm(contact)} className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] rounded transition-colors" title="Delete"><i className="fas fa-trash-alt text-[11px]"></i></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {currentContacts.length === 0 && (
                      <tr><td colSpan={6 + columns.length} className="px-5 py-10 text-center"><p className="text-sm text-[#9B9890]">No contacts found</p><p className="text-xs text-[#9B9890] mt-1">Add contacts or import from CSV</p></td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="border-t border-[#E3E1DB] px-5 py-3 flex items-center justify-between bg-[#F7F6F3] flex-shrink-0">
                  <p className="text-xs text-[#9B9890]">{startIndex + 1}–{Math.min(startIndex + contactsPerPage, filteredContacts.length)} of {filteredContacts.length}</p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-left"></i></button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let p = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i
                      return <button key={p} onClick={() => setCurrentPage(p)} className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${currentPage === p ? 'bg-[#D63B1F] text-white border-[#D63B1F]' : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>{p}</button>
                    })}
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50"><i className="fas fa-angle-right"></i></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {showAddContact && (
          <AddContactModal onClose={() => setShowAddContact(false)} contactListId={list.id}
            onContactAdded={() => { fetchContacts(); onContactsUpdated() }} onError={onError} />
        )}
        {showImportCsv && (
          <ImportCsvModal onClose={() => setShowImportCsv(false)} contactListId={list.id}
            listColumns={columns}
            onImportComplete={() => { fetchContacts(); onContactsUpdated() }} onError={onError} />
        )}
        {showManageColumns && (
          <ManageColumnsModal
            listId={list.id}
            columns={columns}
            onClose={() => setShowManageColumns(false)}
            onColumnsChanged={fetchColumns}
          />
        )}
        {deleteContactConfirm && (
          <DeleteContactConfirmModal contact={deleteContactConfirm} selectedCount={selectedContacts.length}
            onConfirm={deleteContactConfirm.multiple ? deleteSelectedContacts : () => deleteContact(deleteContactConfirm.id)}
            onCancel={() => setDeleteContactConfirm(null)} />
        )}
      </div>
    </div>
  )
}

function ManageColumnsModal({ listId, columns, onClose, onColumnsChanged }) {
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')

  const addColumn = async () => {
    if (!newLabel.trim()) return
    setAdding(true)
    setError('')
    try {
      const response = await fetchWithWorkspace(`/api/contact-lists/${listId}/columns`, {
        method: 'POST',
        body: JSON.stringify({ label: newLabel.trim() })
      })
      const data = await response.json()
      if (data.success) { setNewLabel(''); onColumnsChanged() }
      else { setError(data.error || 'Failed to add column') }
    } catch { setError('An error occurred') }
    finally { setAdding(false) }
  }

  const deleteColumn = async (col) => {
    setDeletingId(col.id)
    try {
      const response = await fetchWithWorkspace(`/api/contact-lists/${listId}/columns?column_id=${col.id}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) { onColumnsChanged() }
      else { setError(data.error || 'Failed to delete column') }
    } catch { setError('An error occurred') }
    finally { setDeletingId(null) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
      <div className="bg-[#FFFFFF] rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Custom Columns</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">Use <code className="bg-[#F7F6F3] px-1 rounded">{'{{key}}'}</code> in scenario instructions</p>
          </div>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {columns.length === 0 ? (
            <p className="text-xs text-[#9B9890] text-center py-2">No custom columns yet</p>
          ) : (
            <div className="space-y-1.5">
              {columns.map(col => (
                <div key={col.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-[#F7F6F3] border border-[#E3E1DB] rounded-md">
                  <div>
                    <span className="text-sm font-medium text-[#131210]">{col.label}</span>
                    <span className="text-xs text-[#9B9890] ml-2 font-mono">{`{{${col.key}}}`}</span>
                  </div>
                  <button
                    onClick={() => deleteColumn(col)}
                    disabled={deletingId === col.id}
                    className="p-1 text-[#9B9890] hover:text-[#D63B1F] transition-colors disabled:opacity-50"
                    title="Delete column"
                  >
                    {deletingId === col.id ? <i className="fas fa-spinner fa-spin text-xs"></i> : <i className="fas fa-trash-alt text-xs"></i>}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={newLabel}
              onChange={e => { setNewLabel(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && addColumn()}
              placeholder="Column name, e.g. State"
              className="flex-1 px-3 py-1.5 text-sm border border-[#D4D1C9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#D63B1F]"
            />
            <button onClick={addColumn} disabled={adding || !newLabel.trim()} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
              {adding ? <i className="fas fa-spinner fa-spin"></i> : 'Add'}
            </button>
          </div>
          {error && <p className="text-xs text-[#D63B1F]">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Done</button>
        </div>
      </div>
    </div>
  )
}
