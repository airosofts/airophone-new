'use client'

// Live team presence via Supabase Realtime.
//
// Seeds from /api/presence, then subscribes to Postgres Changes on user_presence
// (filtered to the workspace) so online/offline updates arrive instantly instead
// of on a poll. A short timer re-spreads the map so "online → offline" (window
// expiry, which fires no DB event) is re-evaluated without waiting for the next
// heartbeat from that user.
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { apiGet } from '@/lib/api-client'
import { isOnline as _isOnline } from '@/lib/presence'

export function usePresence(workspaceId) {
  const [presence, setPresence] = useState({})   // userId -> last_seen (ISO)
  // Unique per hook instance so the sidebar + inbox don't collide on one channel.
  const chanIdRef = useRef(null)
  if (!chanIdRef.current) chanIdRef.current = Math.random().toString(36).slice(2)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    // 1) Initial snapshot.
    apiGet('/api/presence')
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.presence) setPresence(d.presence) })
      .catch(() => {})

    // 2) Live updates.
    const channel = supabase
      .channel(`presence_${workspaceId}_${chanIdRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_presence', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const row = payload.new || payload.old
          if (row?.user_id) setPresence(prev => ({ ...prev, [row.user_id]: row.last_seen }))
        }
      )
      .subscribe()

    // 3) Re-evaluate offline on a timer (no event fires when someone goes idle).
    const tick = setInterval(() => setPresence(p => ({ ...p })), 20000)

    return () => { cancelled = true; supabase.removeChannel(channel); clearInterval(tick) }
  }, [workspaceId])

  const isOnline = useCallback(
    (userId, fallbackLastSeen) => _isOnline(presence[userId] ?? fallbackLastSeen),
    [presence]
  )

  return { presence, isOnline }
}
