'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'

const MONDAY_ERRORS = {
  access_denied:            'You denied access on Monday.',
  missing_code_or_state:    'Monday returned an incomplete response. Please try again.',
  state_cookie_missing:     'Your session expired before Monday redirected back. Please try again.',
  state_cookie_corrupt:     'Your session data was corrupted. Please try again.',
  state_mismatch:           'Security check failed (state mismatch). Please try again.',
  state_missing_context:    'Workspace context was lost. Please try again.',
  token_exchange_failed:    'Monday rejected the authorization code. Try connecting again.',
  token_network_error:      "Couldn't reach Monday's API. Try again in a moment.",
  server_misconfigured:     'Monday integration is not configured on the server. Contact support.',
  db_write_failed:          'Connected to Monday but could not save the connection. Try again.',
}

function MondayLogo({ size = 28 }) {
  // Three colored dots — Monday's signature mark, simplified
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="6"  cy="16" r="5" fill="#FF3D57" />
      <circle cx="16" cy="16" r="5" fill="#FFCB00" />
      <circle cx="26" cy="16" r="5" fill="#00CA72" />
    </svg>
  )
}

export default function Integrations() {
  const [status, setStatus] = useState(null) // null = loading, {connected: bool, ...}
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  // App-level board allowlist (Monday OAuth itself grants all boards).
  const [boards, setBoards] = useState(null)        // [{ id, name, enabled }]
  const [boardsSaving, setBoardsSaving] = useState(false)
  const [boardsSaved, setBoardsSaved] = useState(false)

  useEffect(() => {
    if (!status?.connected) { setBoards(null); return }
    fetchWithWorkspace('/api/integrations/monday/boards?all=true')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.boards)) setBoards(d.boards.map(b => ({ id: String(b.id), name: b.name, enabled: b.enabled !== false }))) })
      .catch(() => {})
  }, [status?.connected])

  const toggleBoard = (id) => setBoards(bs => bs.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b))
  const setAllBoards = (on) => setBoards(bs => bs.map(b => ({ ...b, enabled: on })))
  const saveBoards = async () => {
    if (!boards) return
    setBoardsSaving(true)
    try {
      await fetchWithWorkspace('/api/integrations/monday/boards', {
        method: 'POST',
        body: JSON.stringify({ boardIds: boards.filter(b => b.enabled).map(b => b.id) }),
      })
      setBoardsSaved(true); setTimeout(() => setBoardsSaved(false), 2000)
    } finally { setBoardsSaving(false) }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetchWithWorkspace('/api/integrations/monday')
      const data = await res.json()
      setStatus(data)
    } catch (e) {
      console.error('[integrations] load failed:', e)
      setStatus({ connected: false })
    }
  }, [])

  // Pick up redirect-back flags from the OAuth callback and clean the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('monday_connected')
    const errCode = params.get('monday_error')

    if (connected || errCode) {
      if (connected) setSuccess('Monday connected.')
      if (errCode) setError(MONDAY_ERRORS[errCode] || `Couldn't connect (${errCode}).`)
      // Strip the params so a refresh doesn't re-show the banner.
      params.delete('monday_connected')
      params.delete('monday_error')
      const next = window.location.pathname + (params.toString() ? '?' + params.toString() : '')
      window.history.replaceState({}, '', next)
    }

    load()
  }, [load])

  const handleConnect = () => {
    // Browser navigates directly — server route handles auth + redirect to Monday.
    window.location.href = '/api/integrations/monday/oauth/start'
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    setError('')
    try {
      const res = await fetchWithWorkspace('/api/integrations/monday', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Disconnect failed')
      setStatus({ connected: false })
      setSuccess('Monday disconnected.')
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setDisconnecting(false)
      setConfirmDisconnect(false)
    }
  }

  const isLoading = status === null

  return (
    <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
      <div className="px-5 py-4 border-b border-[#E3E1DB]">
        <h3 className="text-sm font-semibold text-[#131210]">Integrations</h3>
        <p className="text-xs text-[#9B9890] mt-0.5">Connect external tools to pull contacts and trigger campaigns</p>
      </div>

      <div className="px-5 py-5 space-y-3">

        {/* Banners */}
        {success && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs bg-[rgba(31,140,74,0.07)] border border-[rgba(31,140,74,0.18)] text-[#1F8C4A]">
            <i className="fas fa-check-circle" /> {success}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.18)] text-[#D63B1F]">
            <i className="fas fa-exclamation-circle" /> {error}
          </div>
        )}

        {/* Monday card */}
        <div className="flex items-center gap-4 p-4 rounded-lg border border-[#E3E1DB] bg-[#FFFFFF]">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-[#F7F6F3] flex items-center justify-center">
            <MondayLogo size={26} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[#131210] truncate">Monday.com</p>
              {status?.connected && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[rgba(31,140,74,0.08)] text-[#1F8C4A] border border-[rgba(31,140,74,0.18)]">
                  Connected
                </span>
              )}
            </div>
            <p className="text-xs text-[#9B9890] mt-0.5 truncate">
              {isLoading
                ? 'Checking connection…'
                : status?.connected
                  ? <>Account: <span className="text-[#5C5A55] font-medium">{status.account_name || status.account_slug || '—'}</span></>
                  : 'Send campaigns from any Monday board. Map columns to message placeholders.'}
            </p>
          </div>

          <div className="shrink-0">
            {isLoading ? (
              <div className="text-xs text-[#9B9890]">…</div>
            ) : status?.connected ? (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="text-xs px-3 py-1.5 rounded-md border border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3] transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#D63B1F] text-white hover:opacity-90 transition-opacity"
              >
                Connect
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#9B9890] mt-3 leading-relaxed">
          Once connected, you&rsquo;ll see a <span className="font-medium text-[#5C5A55]">Source</span> option when creating a campaign — pick a board, choose which groups to include, and Monday columns become message placeholders.
        </p>

        {/* Board allowlist — choose which boards AiroPhone can use */}
        {status?.connected && (
          <div className="mt-4 pt-4 border-t border-[#E3E1DB]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-xs font-semibold text-[#5C5A55]">Boards available to this workspace</p>
              {boards && boards.length > 0 && (
                <button onClick={saveBoards} disabled={boardsSaving}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#D63B1F] text-white hover:opacity-90 disabled:opacity-50">
                  {boardsSaving ? 'Saving…' : boardsSaved ? 'Saved ✓' : 'Save'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-[#9B9890] mb-2.5 leading-relaxed">
              Monday connects every board on the account. Choose which ones AiroPhone may use in Automations, Campaigns and follow-up status — the rest stay hidden.
            </p>
            {boards === null ? (
              <p className="text-[11px] text-[#9B9890]">Loading boards…</p>
            ) : boards.length === 0 ? (
              <p className="text-[11px] text-[#9B9890]">No boards found on this account.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-1.5 text-[11px]">
                  <button type="button" onClick={() => setAllBoards(true)} className="text-[#D63B1F] hover:underline">Select all</button>
                  <button type="button" onClick={() => setAllBoards(false)} className="text-[#9B9890] hover:underline">Clear</button>
                  <span className="text-[#9B9890] ml-auto">{boards.filter(b => b.enabled).length} of {boards.length} enabled</span>
                </div>
                <div className="max-h-56 overflow-y-auto border border-[#E3E1DB] rounded-lg divide-y divide-[#F0EEE9]">
                  {boards.map(b => (
                    <label key={b.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3]">
                      <input type="checkbox" checked={b.enabled} onChange={() => toggleBoard(b.id)} className="accent-[#D63B1F]" />
                      <span className="text-sm text-[#131210] truncate">{b.name}</span>
                    </label>
                  ))}
                </div>
                {boards.every(b => !b.enabled) && (
                  <p className="text-[11px] text-[#D63B1F] mt-1.5">No boards selected — Monday won&rsquo;t appear as an option until you enable at least one.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Disconnect confirmation */}
      {confirmDisconnect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Disconnect Monday.com?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">
                Campaigns currently linked to Monday boards will stop pulling fresh data. You can reconnect any time.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              <button
                onClick={() => setConfirmDisconnect(false)}
                disabled={disconnecting}
                className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]"
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-60"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
