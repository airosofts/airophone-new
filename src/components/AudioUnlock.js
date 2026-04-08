'use client'
// Unlocks browser audio on first user interaction so ringtones play even in background tabs.
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
        // Create a silent AudioContext — this "unlocks" the audio policy for the entire origin
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (!AudioContext) return

        const ctx = new AudioContext()
        const buf = ctx.createBuffer(1, 1, 22050)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start(0)

        // Resume suspended context (required in some browsers)
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }

        // Also play and immediately pause a silent Audio element to unlock HTMLAudioElement
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
