'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiPost, apiGet, apiDelete } from '@/lib/api-client'

export default function ApiKeys() {
  const [keys, setKeys]                   = useState([])
  const [loading, setLoading]             = useState(true)
  const [creating, setCreating]           = useState(false)
  const [newKeyName, setNewKeyName]       = useState('')
  const [showCreate, setShowCreate]       = useState(false)
  const [revealedKey, setRevealedKey]     = useState(null)
  const [revoking, setRevoking]           = useState(null)
  const [confirmRevoke, setConfirmRevoke] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting]           = useState(null)
  const [error, setError]                 = useState(null)
  const [copied, setCopied]               = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await apiGet('/api/api-keys')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load keys')
      setKeys(data.keys || [])
    } catch (err) {
      setError(err.message || 'Failed to load API keys.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  async function handleCreate(e) {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res  = await apiPost('/api/api-keys', { name: newKeyName.trim() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create API key')
      setRevealedKey({ rawKey: data.rawKey, name: data.key.name })
      setNewKeyName('')
      setShowCreate(false)
      loadKeys()
    } catch (err) {
      setError(err.message || 'Failed to create API key.')
    } finally {
      setCreating(false)
    }
  }

  async function confirmRevokeKey() {
    const { id } = confirmRevoke
    setConfirmRevoke(null)
    setRevoking(id)
    try {
      const res = await apiDelete(`/api/api-keys/${id}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to revoke key')
      }
      setKeys(prev => prev.map(k => k.id === id ? { ...k, is_active: false } : k))
    } catch (err) {
      setError(err.message || 'Failed to revoke key.')
    } finally {
      setRevoking(null)
    }
  }

  async function confirmDeleteKey() {
    const { id } = confirmDelete
    setConfirmDelete(null)
    setDeleting(id)
    try {
      const res = await apiDelete(`/api/api-keys/${id}?permanent=true`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete key')
      }
      setKeys(prev => prev.filter(k => k.id !== id))
    } catch (err) {
      setError(err.message || 'Failed to delete key.')
    } finally {
      setDeleting(null)
    }
  }

  async function handleCopy() {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey.rawKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* silent */ }
  }

  function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="space-y-4">

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[rgba(214,59,31,0.07)] border border-red-200 rounded-lg text-sm text-red-700">
          <i className="fas fa-exclamation-circle text-red-400 shrink-0"></i>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-red-500">
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>
      )}

      {/* Keys table */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">API Keys</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">Each key grants full send access to your workspace</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setError(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <i className="fas fa-plus text-xs"></i>
            <span className="hidden sm:inline">Generate Key</span>
            <span className="sm:hidden">New Key</span>
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-[#9B9890]">
            <i className="fas fa-spinner fa-spin mr-2"></i>Loading…
          </div>
        ) : keys.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9B9890]">No API keys yet</p>
            <p className="text-xs text-[#9B9890] mt-1">Generate a key to let external tools send messages</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="md:hidden divide-y divide-[#E3E1DB]">
              {keys.map(k => (
                <div key={k.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#131210]">{k.name}</p>
                      <code className="mt-0.5 inline-block px-2 py-0.5 bg-[#EFEDE8] text-[#5C5A55] text-xs font-mono rounded">{k.key_prefix}…</code>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {k.is_active
                        ? <span className="px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 rounded-full">Active</span>
                        : <span className="px-2 py-0.5 text-xs font-medium bg-[#EFEDE8] text-[#9B9890] rounded-full">Revoked</span>
                      }
                      {k.is_active ? (
                        <button
                          onClick={() => setConfirmRevoke({ id: k.id, name: k.name })}
                          disabled={revoking === k.id}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                        >
                          {revoking === k.id ? <i className="fas fa-spinner fa-spin"></i> : 'Revoke'}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete({ id: k.id, name: k.name })}
                          disabled={deleting === k.id}
                          className="text-xs text-[#9B9890] hover:text-red-600 disabled:opacity-40"
                        >
                          {deleting === k.id ? <i className="fas fa-spinner fa-spin"></i> : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-4 text-xs text-[#9B9890]">
                    <span>Created {formatDate(k.created_at)}</span>
                    {k.last_used_at && <span>Last used {formatDate(k.last_used_at)}</span>}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table view */}
            <table className="hidden md:table min-w-full">
              <thead>
                <tr className="border-b border-[#E3E1DB]">
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-[#9B9890]">Name</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-[#9B9890]">Key</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-[#9B9890]">Created</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-[#9B9890]">Last used</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-[#9B9890]">Status</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E1DB]">
                {keys.map(k => (
                  <tr key={k.id} className="hover:bg-[#F7F6F3]">
                    <td className="px-5 py-3 text-sm font-medium text-[#131210]">{k.name}</td>
                    <td className="px-5 py-3">
                      <code className="px-2 py-0.5 bg-[#EFEDE8] text-[#5C5A55] text-xs font-mono rounded">{k.key_prefix}…</code>
                    </td>
                    <td className="px-5 py-3 text-xs text-[#9B9890]">{formatDate(k.created_at)}</td>
                    <td className="px-5 py-3 text-xs text-[#9B9890]">{formatDate(k.last_used_at)}</td>
                    <td className="px-5 py-3">
                      {k.is_active
                        ? <span className="px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 rounded-full">Active</span>
                        : <span className="px-2 py-0.5 text-xs font-medium bg-[#EFEDE8] text-[#9B9890] rounded-full">Revoked</span>
                      }
                    </td>
                    <td className="px-5 py-3 text-right">
                      {k.is_active ? (
                        <button
                          onClick={() => setConfirmRevoke({ id: k.id, name: k.name })}
                          disabled={revoking === k.id}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                        >
                          {revoking === k.id ? <i className="fas fa-spinner fa-spin"></i> : 'Revoke'}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete({ id: k.id, name: k.name })}
                          disabled={deleting === k.id}
                          className="text-xs text-[#9B9890] hover:text-red-600 disabled:opacity-40"
                        >
                          {deleting === k.id ? <i className="fas fa-spinner fa-spin"></i> : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Integration guide */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">Integration Guide</h3>
          <p className="text-xs text-[#9B9890] mt-0.5">Send SMS from any external tool using your API key</p>
        </div>
        <div className="p-4 md:p-5">
          <div className="bg-[#0F0E0C] rounded-lg overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/5 overflow-hidden">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70 shrink-0"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70 shrink-0"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/70 shrink-0"></span>
              <span className="ml-auto text-[10px] text-[#9B9890] font-mono truncate">POST /api/external/sms/send</span>
            </div>
            <div className="overflow-x-auto">
              <pre className="px-4 py-4 text-xs font-mono text-[#D4D1C9] leading-relaxed min-w-0">{`POST https://ap.airosofts.com/api/external/sms/send
Authorization: Bearer airo_live_<your-key>
Content-Type: application/json

{
  "from":    "+13203158316",
  "to":      "+1XXXXXXXXXX",
  "message": "Hello from your app!"
}

// 200 OK
{ "success": true, "messageId": "msg_xxx" }

// 402 Insufficient Credits
{ "error": "Insufficient credits" }`}
              </pre>
            </div>
          </div>
          <p className="mt-3 text-xs text-[#9B9890]">
            Each SMS deducts 1 credit from your wallet. A <code className="bg-[#EFEDE8] px-1 rounded">402</code> is returned when credits run out.
          </p>
        </div>
      </div>

      {/* Revoke confirm */}
      {confirmRevoke && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Revoke API Key</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">Revoke <span className="font-medium text-[#131210]">"{confirmRevoke.name}"</span>? Any tool using this key will stop working immediately.</p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              <button onClick={() => setConfirmRevoke(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={confirmRevokeKey} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">Revoke</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm (permanent) */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Permanently Delete Key</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">Permanently delete <span className="font-medium text-[#131210]">"{confirmDelete.name}"</span>? This will remove it from your list entirely.</p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={confirmDeleteKey} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Create key modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">New API Key</h3>
              <button onClick={() => { setShowCreate(false); setNewKeyName('') }} className="text-[#9B9890] hover:text-[#5C5A55]">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Key Name</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  placeholder='e.g. "My SMS Tool"'
                  maxLength={64} autoFocus
                  className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                />
                <p className="text-xs text-[#9B9890] mt-1">Give it a descriptive name so you can identify it later</p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setShowCreate(false); setNewKeyName('') }}
                  className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
                <button type="submit" disabled={creating || !newKeyName.trim()}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
                  {creating ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Generating…</> : 'Generate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revealed key modal */}
      {revealedKey && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
              <div className="flex items-center gap-2">
                <i className="fas fa-check-circle text-green-500 text-sm"></i>
                <h3 className="text-sm font-semibold text-[#131210]">API Key Created</h3>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-md">
                <i className="fas fa-exclamation-triangle text-amber-500 text-xs mt-0.5 shrink-0"></i>
                <p className="text-xs text-amber-800">
                  <strong>Copy this key now.</strong> It will never be shown again.
                </p>
              </div>
              <div className="bg-[#0F0E0C] rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                  <span className="text-[11px] text-[#9B9890] font-mono uppercase tracking-wider">Your API Key</span>
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-[#FFFFFF]/10 hover:bg-[#FFFFFF]/20 text-[#D4D1C9]'}`}
                  >
                    <i className={`fas ${copied ? 'fa-check' : 'fa-copy'} text-xs`}></i>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="px-3 py-3">
                  <code className="text-sm text-green-400 font-mono break-all select-all">{revealedKey.rawKey}</code>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => { setRevealedKey(null); setCopied(false) }}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
