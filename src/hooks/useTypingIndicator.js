'use client'

// Live "X is typing…" for a conversation, via Supabase Realtime Broadcast.
// Broadcast is ephemeral (no table, no migration): every client viewing a
// conversation joins a per-conversation channel; while a teammate types we send
// throttled "typing" pings, and listeners show the indicator until a matching
// "stop" ping or a short TTL expires.
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const TYPING_TTL_MS = 4000   // auto-clear a typer if no ping within this

export function useTypingIndicator(conversationId, me) {
  const [typingUsers, setTypingUsers] = useState([])   // [{ userId, name }]
  const channelRef = useRef(null)
  const expiryRef = useRef(new Map())   // userId -> timeout id
  const lastSentRef = useRef(0)
  const myId = me?.userId || null

  useEffect(() => {
    if (!conversationId) return

    // Reset when switching conversations.
    setTypingUsers([])
    expiryRef.current.forEach(clearTimeout)
    expiryRef.current.clear()

    const dropTyper = (userId) => {
      setTypingUsers(prev => prev.filter(u => u.userId !== userId))
      const m = expiryRef.current
      if (m.has(userId)) { clearTimeout(m.get(userId)); m.delete(userId) }
    }

    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    })

    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const uid = payload?.userId
      if (!uid || uid === myId) return
      setTypingUsers(prev => prev.some(u => u.userId === uid)
        ? prev
        : [...prev, { userId: uid, name: payload.name || 'Someone', avatar: payload.avatar || null }])
      const m = expiryRef.current
      if (m.has(uid)) clearTimeout(m.get(uid))
      m.set(uid, setTimeout(() => dropTyper(uid), TYPING_TTL_MS))
    })

    channel.on('broadcast', { event: 'stop' }, ({ payload }) => {
      if (payload?.userId) dropTyper(payload.userId)
    })

    channel.subscribe()
    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
      expiryRef.current.forEach(clearTimeout)
      expiryRef.current.clear()
      setTypingUsers([])
    }
  }, [conversationId, myId])

  // Call on each keystroke — throttled so we send at most once every 2s.
  const notifyTyping = useCallback(() => {
    const ch = channelRef.current
    if (!ch || !myId) return
    const now = Date.now()
    if (now - lastSentRef.current < 2000) return
    lastSentRef.current = now
    ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, name: me?.name, avatar: me?.profile_photo_url || me?.avatar || null } })
  }, [myId, me?.name])

  // Call when the user stops (blur / send / cleared input).
  const notifyStop = useCallback(() => {
    const ch = channelRef.current
    if (!ch || !myId) return
    lastSentRef.current = 0
    ch.send({ type: 'broadcast', event: 'stop', payload: { userId: myId } })
  }, [myId])

  return { typingUsers, notifyTyping, notifyStop }
}
