'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'

const C = {
  bg: '#F7F6F3', surface: '#FFFFFF', border: '#E3E1DB',
  text: '#131210', text2: '#5C5A55', text3: '#9B9890',
  red: '#D63B1F', redBg: 'rgba(214,59,31,0.07)', redDim: 'rgba(214,59,31,0.14)',
  sans: "'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
}

function Avatar({ name, avatar, size = 32 }) {
  if (avatar) {
    return <img src={avatar} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: C.redBg, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.34, fontWeight: 600, color: C.red,
    }}>
      {name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  )
}

function RoleBadge({ role }) {
  const isOwner = role === 'owner'
  const isAdmin = role === 'admin'
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', fontFamily: C.mono,
      padding: '2px 7px', borderRadius: 4,
      background: isOwner ? C.redDim : '#EFEDE8',
      color: isOwner ? C.red : C.text3,
    }}>
      {role}
    </span>
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

  const isOwnerOrAdmin = ['owner', 'admin'].includes(
    members.find(m => m.userId === user?.userId)?.role
  )

  return (
    <div style={{ maxWidth: 640, fontFamily: C.sans }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: C.text, letterSpacing: '-0.03em', margin: 0 }}>
          Team Members
        </h2>
        <p style={{ fontSize: 13, color: C.text3, marginTop: 4, fontWeight: 300 }}>
          Manage who has access to your workspace.
        </p>
      </div>

      {/* Invite form */}
      {isOwnerOrAdmin && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '18px 20px', marginBottom: 20,
        }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 14 }}>
            Invite a team member
          </p>
          <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={e => { setInviteEmail(e.target.value); setError(null); setSuccess(null) }}
              required
              style={{
                flex: 1, minWidth: 200, height: 38, borderRadius: 8,
                border: `1px solid ${C.border}`, padding: '0 12px',
                fontSize: 13, color: C.text, outline: 'none',
                fontFamily: C.sans, background: C.bg,
              }}
              onFocus={e => e.target.style.borderColor = C.red}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              style={{
                height: 38, borderRadius: 8, border: `1px solid ${C.border}`,
                padding: '0 10px', fontSize: 13, color: C.text2, outline: 'none',
                fontFamily: C.sans, background: C.surface, cursor: 'pointer',
              }}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              style={{
                height: 38, padding: '0 18px', borderRadius: 8, border: 'none',
                background: inviting || !inviteEmail.trim() ? '#EFEDE8' : C.red,
                color: inviting || !inviteEmail.trim() ? C.text3 : '#fff',
                fontSize: 13, fontWeight: 500, cursor: inviting ? 'not-allowed' : 'pointer',
                fontFamily: C.sans, transition: 'background 0.15s', whiteSpace: 'nowrap',
              }}
            >
              {inviting ? 'Sending...' : 'Send invite'}
            </button>
          </form>

          {error && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: C.red }}>{error}</p>
          )}
          {success && (
            <p style={{ marginTop: 10, fontSize: 12.5, color: '#16a34a' }}>{success}</p>
          )}
        </div>
      )}

      {/* Members list */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
            {loading ? 'Loading...' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: C.text3 }}>Loading members...</p>
          </div>
        ) : members.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: C.text3 }}>No members yet.</p>
          </div>
        ) : (
          members.map((member, idx) => {
            const isYou = member.userId === user?.userId
            const canRemove = isOwnerOrAdmin && !isYou && member.role !== 'owner'
            return (
              <div
                key={member.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px',
                  borderBottom: idx < members.length - 1 ? `1px solid ${C.border}` : 'none',
                }}
              >
                <Avatar name={member.name} avatar={member.avatar} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>
                      {member.name}
                    </span>
                    {isYou && (
                      <span style={{
                        fontSize: 10.5, color: C.text3, fontFamily: C.mono,
                        background: '#F0EEE9', padding: '1px 6px', borderRadius: 4,
                      }}>you</span>
                    )}
                    <RoleBadge role={member.role} />
                  </div>
                  <p style={{ fontSize: 12, color: C.text3, margin: '1px 0 0', fontFamily: C.mono }}>
                    {member.email}
                  </p>
                </div>
                {canRemove && (
                  <button
                    onClick={() => handleRemove(member.id, member.name)}
                    disabled={removingId === member.id}
                    title="Remove member"
                    style={{
                      padding: '5px 10px', borderRadius: 7, border: `1px solid ${C.border}`,
                      background: 'transparent', cursor: 'pointer',
                      fontSize: 12, color: C.text3, fontFamily: C.sans,
                      transition: 'all 0.15s', opacity: removingId === member.id ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text3 }}
                  >
                    {removingId === member.id ? 'Removing...' : 'Remove'}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
