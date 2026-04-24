'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'

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
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [removingId, setRemovingId] = useState(null)

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
      if (data.success) setMembers(data.members)
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

  const handleRemove = async (memberId, memberName) => {
    if (!confirm(`Remove ${memberName} from this workspace?`)) return
    setRemovingId(memberId)
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
            <form onSubmit={handleInvite} className="flex gap-2.5 flex-wrap">
              <input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setError(null); setSuccess(null) }}
                required
                className="flex-1 min-w-[200px] h-9 rounded-md border border-[#E3E1DB] bg-[#F7F6F3] px-3 text-sm text-[#131210] outline-none transition-colors focus:border-[#D63B1F] focus:ring-2 focus:ring-[rgba(214,59,31,0.1)]"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="h-9 rounded-md border border-[#E3E1DB] bg-[#FFFFFF] px-3 text-sm text-[#5C5A55] outline-none cursor-pointer"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="h-9 px-4 rounded-md text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: inviting || !inviteEmail.trim() ? '#EFEDE8' : '#D63B1F',
                  color: inviting || !inviteEmail.trim() ? '#9B9890' : '#fff',
                  border: 'none',
                }}
              >
                {inviting ? 'Sending...' : 'Send invite'}
              </button>
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
                      onClick={() => handleRemove(member.id, member.name)}
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
    </div>
  )
}
