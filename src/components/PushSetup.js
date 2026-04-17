'use client'
// PushSetup.js
// Registers the service worker and subscribes to Web Push on first user gesture.
// Exposes window.__airoPushReady so other code can check subscription state.
// Also relays SW messages (CALL_ANSWER / CALL_DECLINE) to the WebRTC hook via
// a custom DOM event: 'airo:sw-message'
import { useEffect } from 'react'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

async function registerAndSubscribe() {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[PushSetup] Push not supported in this browser')
    return
  }
  if (window.__airoPushReady) return  // already done

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    console.log('[PushSetup] Service worker registered')

    // Wait until SW is active (handles the case where it's still installing)
    await navigator.serviceWorker.ready

    // Request notification permission — must be inside a user gesture (called from AudioUnlock handler)
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      console.warn('[PushSetup] Notification permission not granted:', permission)
      return
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!publicKey) {
      console.warn('[PushSetup] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set')
      return
    }

    // Check for existing subscription first
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
      console.log('[PushSetup] New push subscription created')
    } else {
      console.log('[PushSetup] Reusing existing push subscription')
    }

    // Send subscription to our backend
    const session = localStorage.getItem('user_session')
    const user = session ? JSON.parse(session) : null
    if (user?.userId && user?.workspaceId) {
      const headers = {
        'Content-Type': 'application/json',
        'x-user-id': user.userId,
        'x-workspace-id': user.workspaceId
      }
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify(sub.toJSON())
      })
      if (res.ok) {
        window.__airoPushReady = true
        console.log('[PushSetup] Push subscription saved to server')
      }
    }
  } catch (err) {
    console.warn('[PushSetup] Setup failed:', err.message)
  }
}

export default function PushSetup() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Register SW and subscribe on first user gesture (same pattern as AudioUnlock)
    // We piggyback on AudioUnlock's gesture events so we don't double-prompt
    const handleGesture = () => { registerAndSubscribe() }
    const events = ['click', 'touchstart', 'keydown']
    events.forEach(e => document.addEventListener(e, handleGesture, { capture: true, passive: true, once: true }))

    // Also try immediately if already logged in and SW might already be registered
    if (Notification?.permission === 'granted') {
      registerAndSubscribe()
    }

    // Listen for messages from the Service Worker (Answer/Decline actions from notification)
    const onSwMessage = (event) => {
      const { type, callId } = event.data || {}
      if (!type) return
      console.log('[PushSetup] SW message:', type, callId)
      // Dispatch a DOM event so useWebRTCCall can listen without circular imports
      window.dispatchEvent(new CustomEvent('airo:sw-message', { detail: { type, callId } }))
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage)

    return () => {
      events.forEach(e => document.removeEventListener(e, handleGesture, { capture: true }))
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
    }
  }, [])

  return null
}
