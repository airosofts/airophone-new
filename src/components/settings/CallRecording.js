'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'

export default function CallRecording() {
  const [status, setStatus] = useState(null) // null=loading, object=loaded
  const [enabling, setEnabling] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'success'|'error', text }

  const getHeaders = () => {
    const user = getCurrentUser()
    return {
      'Content-Type': 'application/json',
      'x-user-id': user?.userId || '',
      'x-workspace-id': user?.workspaceId || '',
      'x-messaging-profile-id': user?.messagingProfileId || '',
    }
  }

  useEffect(() => {
    fetch('/api/settings/enable-recording', { headers: getHeaders() })
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => setStatus({ configured: false, error: 'Failed to load status' }))
  }, [])

  const handleEnable = async () => {
    setEnabling(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/enable-recording', {
        method: 'POST',
        headers: getHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        setStatus(prev => ({ ...prev, recordOnAnswer: true, webhookUrl: data.webhookUrl }))
        setMessage({ type: 'success', text: data.message })
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to enable recording' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Request failed. Please try again.' })
    } finally {
      setEnabling(false)
    }
  }

  const isEnabled = status?.recordOnAnswer === true
  const hasConnection = status?.configured !== false

  return (
    <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#E3E1DB]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-[rgba(214,59,31,0.08)] rounded-lg flex items-center justify-center">
            <i className="fas fa-circle-dot text-[#D63B1F] text-sm"></i>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#131210]">Call Recording</h3>
            <p className="text-xs text-[#9B9890]">Automatically record all inbound and outbound calls</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* Status card */}
        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-[#9B9890]">
            <i className="fas fa-spinner fa-spin text-xs"></i>
            Checking status…
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${isEnabled ? 'bg-green-500' : 'bg-[#D4D1C9]'}`} />
              <div>
                <p className="text-sm font-medium text-[#131210]">
                  {isEnabled ? 'Recording enabled' : 'Recording disabled'}
                </p>
                {status.webhookUrl && (
                  <p className="text-xs text-[#9B9890] mt-0.5 font-mono truncate max-w-xs">{status.webhookUrl}</p>
                )}
              </div>
            </div>
            {isEnabled && (
              <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Active</span>
            )}
          </div>
        )}

        {/* What gets recorded */}
        <div className="space-y-2">
          {[
            { icon: 'fa-phone-arrow-down-left', label: 'Inbound calls', desc: 'Calls received on your AiroPhone numbers' },
            { icon: 'fa-phone-arrow-up-right', label: 'Outbound calls', desc: 'Calls you make from AiroPhone' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3 px-3 py-2.5 border border-[#E3E1DB] rounded-lg">
              <div className="w-7 h-7 bg-[rgba(214,59,31,0.08)] rounded-full flex items-center justify-center shrink-0">
                <i className={`fas ${item.icon} text-[#D63B1F] text-xs`}></i>
              </div>
              <div>
                <p className="text-sm font-medium text-[#131210]">{item.label}</p>
                <p className="text-xs text-[#9B9890]">{item.desc}</p>
              </div>
              <i className="fas fa-check text-green-600 text-xs ml-auto"></i>
            </div>
          ))}
        </div>

        <div className="text-xs text-[#9B9890] bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg px-3 py-2.5">
          <i className="fas fa-info-circle mr-1.5"></i>
          Recordings are stored by Telnyx and linked to the conversation thread. They appear as playable audio in the chat window after the call ends.
        </div>

        {/* Feedback message */}
        {message && (
          <div className={`px-3 py-2.5 rounded-lg text-sm flex items-start gap-2 ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.2)] text-[#D63B1F]'
          }`}>
            <i className={`fas ${message.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mt-0.5 shrink-0`}></i>
            {message.text}
          </div>
        )}

        {/* Action button */}
        {!isEnabled && (
          <button
            onClick={handleEnable}
            disabled={enabling || !hasConnection}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {enabling ? (
              <><i className="fas fa-spinner fa-spin text-xs"></i> Enabling…</>
            ) : (
              <><i className="fas fa-circle-dot text-xs"></i> Enable Call Recording</>
            )}
          </button>
        )}

        {isEnabled && (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <i className="fas fa-check-circle"></i>
            Call recording is active. All future calls will be recorded automatically.
          </div>
        )}
      </div>
    </div>
  )
}
