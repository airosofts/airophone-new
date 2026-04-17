// AiroPhone Service Worker — handles Web Push for background call notifications
// This file must be in /public so it is served at /sw.js (same origin required)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ── Push received (tab closed or backgrounded) ─────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return

  let data = {}
  try { data = event.data.json() } catch (_) { return }

  const { title, body, from, callId, workspaceId, tag } = data

  event.waitUntil(
    self.registration.showNotification(title || '📞 Incoming Call', {
      body: body || `Call from ${from || 'Unknown'}`,
      icon: '/favicon.ico',
      badge: '/favicon-32x32.png',
      tag: tag || 'incoming-call',          // deduplicates: only 1 call notification at a time
      requireInteraction: true,             // stays on screen until user acts
      renotify: true,                       // re-alert even if tag already shown
      vibrate: [200, 100, 200, 100, 200],  // vibration pattern on mobile
      data: { callId, workspaceId, from, url: '/inbox' },
      actions: [
        { action: 'answer', title: '✅ Answer' },
        { action: 'decline', title: '❌ Decline' }
      ]
    })
  )
})

// ── Notification click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'decline') {
    // Tell any open tab to reject the call
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
        for (const tab of tabs) {
          tab.postMessage({ type: 'CALL_DECLINE', callId: event.notification.data?.callId })
        }
      })
    )
    return
  }

  // Answer action OR clicking the notification body — focus/open the tab
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      const appTab = tabs.find(t => t.url.includes(self.location.origin))

      const focusAndAnswer = (tab) => {
        tab.focus()
        tab.postMessage({ type: 'CALL_ANSWER', callId: event.notification.data?.callId })
      }

      if (appTab) {
        focusAndAnswer(appTab)
      } else {
        // Open a new tab and send the answer message once it loads
        self.clients.openWindow(event.notification.data?.url || '/inbox').then((newTab) => {
          if (newTab) {
            // Small delay to let the page initialize before sending the message
            setTimeout(() => {
              newTab.postMessage({ type: 'CALL_ANSWER', callId: event.notification.data?.callId })
            }, 3000)
          }
        })
      }
    })
  )
})

// ── Notification close (user dismissed without acting) ─────────────────────
self.addEventListener('notificationclose', (event) => {
  // Notify any open tab that the notification was dismissed so it can update UI
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
    for (const tab of tabs) {
      tab.postMessage({ type: 'CALL_NOTIFICATION_DISMISSED', callId: event.notification.data?.callId })
    }
  })
})
