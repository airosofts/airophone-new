'use client'

import { useState, useEffect } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'

export default function AiSettings() {
  const [minDelay, setMinDelay] = useState(0)
  const [maxDelay, setMaxDelay] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchWithWorkspace('/api/ai-settings')
        const data = await res.json()
        if (data.success) {
          setMinDelay(data.settings.ai_reply_delay_min ?? 0)
          setMaxDelay(data.settings.ai_reply_delay_max ?? 0)
        }
      } catch (e) {
        console.error('Error loading AI settings:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    const min = Math.max(0, parseInt(minDelay) || 0)
    const max = Math.max(0, parseInt(maxDelay) || 0)

    if (max > 0 && max < min) {
      alert('Max delay must be greater than or equal to min delay.')
      return
    }

    setSaving(true)
    try {
      const res = await fetchWithWorkspace('/api/ai-settings', {
        method: 'PUT',
        body: JSON.stringify({ ai_reply_delay_min: min, ai_reply_delay_max: max })
      })
      const data = await res.json()
      if (data.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch (e) {
      console.error('Error saving AI settings:', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
      <div className="px-5 py-4 border-b border-[#E3E1DB]">
        <h3 className="text-sm font-semibold text-[#131210]">AI Reply Settings</h3>
        <p className="text-xs text-[#9B9890] mt-0.5">Configure how AI scenarios behave when responding</p>
      </div>

      <div className="px-5 py-5 space-y-6">
        {/* Reply Delay */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-[#131210]">Reply delay</h4>
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">Humanize</span>
          </div>
          <p className="text-xs text-[#9B9890] mb-4">
            AI will wait a random time between min and max before sending a reply — making responses feel more natural.
            Set both to <strong>0</strong> to reply instantly.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Min delay (seconds)</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="300"
                  value={minDelay}
                  onChange={(e) => setMinDelay(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:border-[#D63B1F] focus:ring-1 focus:ring-[#D63B1F]/20 disabled:bg-[#F7F6F3] disabled:text-[#9B9890]"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9B9890] pointer-events-none">sec</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Max delay (seconds)</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="300"
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:border-[#D63B1F] focus:ring-1 focus:ring-[#D63B1F]/20 disabled:bg-[#F7F6F3] disabled:text-[#9B9890]"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9B9890] pointer-events-none">sec</span>
              </div>
            </div>
          </div>

          {/* Preview */}
          {(parseInt(minDelay) > 0 || parseInt(maxDelay) > 0) && (
            <div className="mt-3 px-3 py-2 bg-[#F7F6F3] rounded-md border border-[#E3E1DB]">
              <p className="text-xs text-[#9B9890]">
                AI will reply after a random delay between{' '}
                <span className="font-semibold text-[#5C5A55]">{parseInt(minDelay) || 0}s</span>
                {' '}and{' '}
                <span className="font-semibold text-[#5C5A55]">{parseInt(maxDelay) || 0}s</span>
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <><i className="fas fa-spinner fa-spin text-xs" />Saving…</>
          ) : saved ? (
            <><i className="fas fa-check text-xs" />Saved</>
          ) : (
            'Save changes'
          )}
        </button>
      </div>
    </div>
  )
}
