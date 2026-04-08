'use client'
// Unlocks browser audio on first user interaction so ringtones play even in background tabs.
// Also pre-decodes call.mp3 into an AudioContext buffer (window.__airoRingBuffer) so
// playRingtone() can use the AudioContext API — which bypasses HTMLAudioElement autoplay
// restrictions and works even when the tab is in the background.
// Must be in the root layout so it runs on every page.
import { useEffect } from 'react'

export default function AudioUnlock() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    let unlocked = false

    const unlock = async () => {
      if (unlocked) return
      unlocked = true

      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (!AudioContext) return

        // Create context in this user-gesture stack — guaranteed to start running
        const ctx = new AudioContext()

        // Play a silent buffer to satisfy browser autoplay policy
        const buf = ctx.createBuffer(1, 1, 22050)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start(0)

        if (ctx.state === 'suspended') await ctx.resume()

        // Expose running context globally — ringtone system reuses this
        window.__airoCtx = ctx

        // Pre-decode call.mp3 into an AudioBuffer while we're in user-gesture context.
        // This lets playRingtone() use createBufferSource() which works in background tabs.
        try {
          const res = await fetch('/call.mp3')
          const arrayBuf = await res.arrayBuffer()
          window.__airoRingBuffer = await ctx.decodeAudioData(arrayBuf)
          console.log('[AudioUnlock] Ringtone buffer pre-loaded — background playback ready')
        } catch (e) {
          console.warn('[AudioUnlock] Ringtone preload failed:', e.message)
        }

        // Also unlock HTMLAudioElement as a fallback path
        const silentAudio = new Audio('/call.mp3')
        silentAudio.volume = 0
        silentAudio.muted = true
        const playPromise = silentAudio.play()
        if (playPromise) {
          playPromise.then(() => {
            silentAudio.pause()
            silentAudio.src = ''
          }).catch(() => {})
        }

        console.log('[AudioUnlock] Audio context unlocked for background playback')
      } catch (e) {
        console.warn('[AudioUnlock] Could not unlock audio:', e.message)
      }
    }

    // Unlock on any user gesture
    const events = ['click', 'touchstart', 'keydown', 'mousedown']
    events.forEach(e => document.addEventListener(e, unlock, { once: true, capture: true }))

    return () => {
      events.forEach(e => document.removeEventListener(e, unlock, { capture: true }))
    }
  }, [])

  return null
}
