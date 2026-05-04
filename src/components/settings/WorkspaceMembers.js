'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'

function ConfirmModal({ isOpen, title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(19,18,16,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-[#FFFFFF] rounded-xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden border border-[#E3E1DB]">
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-[#5C5A55] leading-relaxed">{message}</p>
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors"
            style={{ background: danger ? '#D63B1F' : '#131210', color: '#fff', border: 'none' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function Avatar({ name, avatar, size = 32 }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(214,59,31,0.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.38, fontWeight: 600, color: '#D63B1F',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      {name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  )
}

export default function WorkspaceMembers() {
  const [user, setUser] = useState(null)
  const [members, setMembers] = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [revokingId, setRevokingId] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null) // { type: 'remove'|'revoke', id, name, email }

  useEffect(() => {
    const u = getCurrentUser()
    setUser(u)
    fetchMembers()
  }, [])

  const fetchMembers = async () => {
    setLoading(true)
    try {
      const res = await apiGet('/api/workspace/members')
      const data = await res.json()
      if (data.success) {
        setMembers(data.members)
        setPendingInvites(data.pendingInvites || [])
      }
    } catch (e) {
      console.error('Failed to fetch members:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async (e) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setError(null)
    setSuccess(null)
    setInviting(true)
    try {
      const session = localStorage.getItem('user_session')
      const s = session ? JSON.parse(session) : {}
      const res = await fetch('/api/workspace/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': s.userId || '',
          'x-workspace-id': s.workspaceId || '',
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to invite member')
      } else {
        setSuccess(data.message || 'Invite sent')
        setInviteEmail('')
        fetchMembers()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (memberId) => {
    setRemovingId(memberId)
    setConfirmModal(null)
    try {
      const session = localStorage.getItem('user_session')
      const s = session ? JSON.parse(session) : {}
      const res = await fetch(`/api/workspace/members/${memberId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': s.userId || '',
          'x-workspace-id': s.workspaceId || '',
        },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to remove member')
      } else {
        setMembers(prev => prev.filter(m => m.id !== memberId))
      }
    } catch {
      setError('Something went wrong.')
    } finally {
      setRemovingId(null)
    }
  }

  const handleRevoke = async (inviteId) => {
    setRevokingId(inviteId)
    setConfirmModal(null)
    try {
      const session = localStorage.getItem('user_session')
      const s = session ? JSON.parse(session) : {}
      const res = await fetch(`/api/workspace/invites/${inviteId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': s.userId || '',
          'x-workspace-id': s.workspaceId || '',
        },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to revoke invite')
      } else {
        setPendingInvites(prev => prev.filter(i => i.id !== inviteId))
      }
    } catch {
      setError('Something went wrong.')
    } finally {
      setRevokingId(null)
    }
  }

  const currentMember = members.find(m => m.userId === user?.userId)
  const isOwnerOrAdmin = ['owner', 'admin'].includes(currentMember?.role)

  const roleBadge = (role) => {
    const isOwner = role === 'owner'
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide font-mono ${
        isOwner ? 'bg-[rgba(214,59,31,0.12)] text-[#D63B1F]' : 'bg-[#EFEDE8] text-[#9B9890]'
      }`}>
        {role}
      </span>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">

      <ConfirmModal
        isOpen={!!confirmModal}
        title={confirmModal?.type === 'remove' ? 'Remove team member' : 'Revoke invite'}
        message={
          confirmModal?.type === 'remove'
            ? `Remove ${confirmModal?.name} from this workspace? They'll lose access immediately.`
            : `Revoke the invite sent to ${confirmModal?.email}? They won't be able to use this invite link.`
        }
        confirmLabel={confirmModal?.type === 'remove' ? 'Remove' : 'Revoke'}
        onConfirm={() => confirmModal?.type === 'remove' ? handleRemove(confirmModal.id) : handleRevoke(confirmModal.id)}
        onCancel={() => setConfirmModal(null)}
      />

      {/* Header */}
      <div>
        <h2 className="text-[17px] font-semibold text-[#131210] tracking-tight">Team Members</h2>
        <p className="text-sm text-[#9B9890] mt-1 font-light">Manage who has access to your workspace.</p>
      </div>

      {/* Invite form */}
      {isOwnerOrAdmin && (
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
          <div className="px-5 py-4 border-b border-[#E3E1DB]">
            <h3 className="text-sm font-semibold text-[#131210]">Invite a team member</h3>
            <p className="text-xs text-[#9B9890] mt-0.5">They'll receive an email to join your workspace.</p>
          </div>
          <div className="px-5 py-4">
            <form onSubmit={handleInvite} className="space-y-2.5 sm:space-y-0 sm:flex sm:gap-2.5 sm:flex-wrap">
              <input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setError(null); setSuccess(null) }}
                required
                className="w-full sm:flex-1 sm:min-w-50 h-9 rounded-md border border-[#E3E1DB] bg-[#F7F6F3] px-3 text-sm text-[#131210] outline-none transition-colors focus:border-[#D63B1F] focus:ring-2 focus:ring-[rgba(214,59,31,0.1)]"
              />
              <div className="flex gap-2.5">
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  className="h-9 flex-1 sm:flex-none rounded-md border border-[#E3E1DB] bg-[#FFFFFF] px-3 text-sm text-[#5C5A55] outline-none cursor-pointer"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="h-9 px-4 rounded-md text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-none"
                  style={{
                    background: inviting || !inviteEmail.trim() ? '#EFEDE8' : '#D63B1F',
                    color: inviting || !inviteEmail.trim() ? '#9B9890' : '#fff',
                    border: 'none',
                  }}
                >
                  {inviting ? 'Sending...' : 'Send invite'}
                </button>
              </div>
            </form>

            {error && (
              <p className="mt-2.5 text-xs text-[#D63B1F] flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                {error}
              </p>
            )}
            {success && (
              <p className="mt-2.5 text-xs text-[#16a34a] flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="16 8 10 14 8 12"/>
                </svg>
                {success}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Members list */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E3E1DB] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#131210]">
            {loading ? 'Members' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
          </h3>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9B9890]">Loading members...</p>
          </div>
        ) : members.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9B9890]">No members yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#E3E1DB]">
            {members.map((member) => {
              const isYou = member.userId === user?.userId
              const canRemove = isOwnerOrAdmin && !isYou && member.role !== 'owner'
              return (
                <div key={member.id} className="flex items-center gap-3.5 px-5 py-3.5">
                  <Avatar name={member.name} avatar={member.avatar} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[#131210]">{member.name}</span>
                      {isYou && (
                        <span className="text-[10.5px] text-[#9B9890] font-mono bg-[#F0EEE9] px-1.5 py-0.5 rounded">
                          you
                        </span>
                      )}
                      {roleBadge(member.role)}
                    </div>
                    <p className="text-xs text-[#9B9890] mt-0.5 font-mono">{member.email}</p>
                  </div>
                  {canRemove && (
                    <button
                      onClick={() => setConfirmModal({ type: 'remove', id: member.id, name: member.name })}
                      disabled={removingId === member.id}
                      className="px-3 py-1.5 text-sm text-[#9B9890] border border-[#E3E1DB] rounded-md hover:border-[#D63B1F] hover:text-[#D63B1F] transition-colors disabled:opacity-50"
                    >
                      {removingId === member.id ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending invites */}
      {isOwnerOrAdmin && pendingInvites.length > 0 && (
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E3E1DB]">
            <h3 className="text-sm font-semibold text-[#131210]">
              Pending invites
              <span className="ml-2 px-1.5 py-0.5 text-[10.5px] font-mono bg-[#EFEDE8] text-[#9B9890] rounded">
                {pendingInvites.length}
              </span>
            </h3>
            <p className="text-xs text-[#9B9890] mt-0.5">Awaiting signup — invite link sent by email.</p>
          </div>
          <div className="divide-y divide-[#E3E1DB]">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3.5 px-5 py-3.5">
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: '#F7F6F3', border: '1px dashed #D4D1C9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-[#5C5A55]">{invite.email}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide font-mono bg-[#EFEDE8] text-[#9B9890]">
                      {invite.role}
                    </span>
                    <span className="text-[10.5px] font-mono bg-[#FEF9C3] text-[#854D0E] px-1.5 py-0.5 rounded">
                      invite pending
                    </span>
                  </div>
                  <p className="text-xs text-[#9B9890] mt-0.5">
                    Invited {new Date(invite.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmModal({ type: 'revoke', id: invite.id, email: invite.email })}
                  disabled={revokingId === invite.id}
                  className="px-3 py-1.5 text-sm text-[#9B9890] border border-[#E3E1DB] rounded-md hover:border-[#D63B1F] hover:text-[#D63B1F] transition-colors disabled:opacity-50"
                >
                  {revokingId === invite.id ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
