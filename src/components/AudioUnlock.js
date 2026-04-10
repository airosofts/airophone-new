'use client'
// AudioUnlock.js
// Unlocks Web Audio API on the first user gesture so ringtones play in any tab state.
// Exposes window.__airoCtx (AudioContext) and window.__airoRingBuffer (decoded AudioBuffer)
// for use by playRingtone(). Also retries buffer load if a previous attempt failed.
import { useEffect } from 'react'

export default function AudioUnlock() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const load = async () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return

        // Reuse existing running context if already set up
        let ctx = window.__airoCtx
        if (!ctx || ctx.state === 'closed') {
          ctx = new AC()
          window.__airoCtx = ctx
        }

        // Resume if suspended (required in some browsers even inside gesture)
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }

        // Play a 1-frame silent buffer — satisfies autoplay policy for HTMLAudioElement too
        const silent = ctx.createBuffer(1, 1, 22050)
        const silentSrc = ctx.createBufferSource()
        silentSrc.buffer = silent
        silentSrc.connect(ctx.destination)
        silentSrc.start(0)

        // If the context gets suspended/interrupted (Chrome 136+ hardware interruption,
        // iOS Safari tab switch, etc.), clear the buffer so the next user gesture
        // re-runs load() and restores the running state.
        // DO NOT call ctx.resume() here without a gesture — it fails silently on iOS Safari.
        ctx.addEventListener('statechange', () => {
          if (ctx.state === 'interrupted' || ctx.state === 'suspended') {
            console.log('[AudioUnlock] ctx state changed to', ctx.state, '— will re-unlock on next gesture')
            window.__airoRingBuffer = null // force reload on next gesture
          }
        })

        // Skip if buffer already decoded successfully
        if (window.__airoRingBuffer) return

        // Fetch and decode call.mp3 into an AudioBuffer.
        // Once decoded, playRingtone() uses createBufferSource() which bypasses
        // all autoplay restrictions — plays even in background tabs.
        const res = await fetch('/call.mp3')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const arrayBuf = await res.arrayBuffer()
        window.__airoRingBuffer = await ctx.decodeAudioData(arrayBuf)

        console.log('[AudioUnlock] Ringtone buffer ready — ctx state:', ctx.state)
      } catch (e) {
        console.warn('[AudioUnlock] Failed:', e.message)
        // Don't set __airoRingBuffer so next gesture retries
        window.__airoRingBuffer = null
      }
    }

    const events = ['click', 'touchstart', 'keydown', 'mousedown', 'pointerdown']

    // Use a non-once listener so retries work if buffer load failed
    const handler = () => { load() }
    events.forEach(e => document.addEventListener(e, handler, { capture: true, passive: true }))

    // Also attempt immediately in case context was already unlocked
    // (e.g. user navigated from another page where they already clicked)
    if (window.__airoCtx && window.__airoCtx.state === 'running' && !window.__airoRingBuffer) {
      load()
    }

    return () => {
      events.forEach(e => document.removeEventListener(e, handler, { capture: true }))
    }
  }, [])

  return null
}
