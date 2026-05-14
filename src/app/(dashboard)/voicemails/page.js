'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'

const STATUS_BADGE = {
  draft:     { label: 'Draft',     cls: 'bg-[#EFEDE8] text-[#5C5A55]' },
  running:   { label: 'Running',   cls: 'bg-blue-50 text-blue-700' },
  completed: { label: 'Completed', cls: 'bg-green-50 text-green-700' },
  failed:    { label: 'Failed',    cls: 'bg-red-50 text-red-600' },
  paused:    { label: 'Paused',    cls: 'bg-yellow-50 text-yellow-700' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function VoicemailsPage() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [contactLists, setContactLists] = useState([])
  const [errorModal, setErrorModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [vRes, pRes, lRes] = await Promise.all([
        apiGet('/api/voicemail-campaigns'),
        apiGet('/api/phone-numbers'),
        apiGet('/api/contact-lists'),
      ])
      const v = await vRes.json()
      const p = await pRes.json()
      const l = await lRes.json()
      if (v.success) setCampaigns(v.campaigns || [])
      if (p.success) setPhoneNumbers(p.phoneNumbers || [])
      if (l.success) setContactLists(l.contactLists || l.lists || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full bg-[#F7F6F3] overflow-auto">
      <div className="p-4 md:p-6 max-w-5xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[20px] font-semibold text-[#131210] tracking-tight">Voicemails</h1>
            <p className="text-[13px] text-[#9B9890] mt-0.5">Send pre-recorded voicemails to your contacts — costs 2 credits per send.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3.5 py-2 bg-[#D63B1F] hover:bg-[#c23119] text-white text-[13px] font-medium rounded-lg"
          >
            + New voicemail
          </button>
        </div>

        <div className="bg-white border border-[#E3E1DB] rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-[#9B9890]">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-[#5C5A55]">No voicemail campaigns yet.</p>
              <p className="text-xs text-[#9B9890] mt-1">Upload an mp3 and send it to a contact list.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E3E1DB]">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] px-5 py-2.5 bg-[#F7F6F3] text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">
                <span>Name</span><span>Sender</span><span>Status</span><span>Sent / Failed</span>
              </div>
              {campaigns.map(c => {
                const badge = STATUS_BADGE[c.status] || STATUS_BADGE.draft
                return (
                  <div key={c.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] px-5 py-3 items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#131210] truncate">{c.name}</p>
                      <p className="text-[11px] text-[#9B9890]">{fmtDate(c.created_at)}</p>
                    </div>
                    <span className="text-[12.5px] text-[#5C5A55] font-mono">{c.sender_number}</span>
                    <span><span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${badge.cls}`}>{badge.label}</span></span>
                    <span className="text-[12.5px] text-[#5C5A55]">
                      <span className="text-[#16a34a] font-medium">{c.sent_count || 0}</span>
                      <span className="text-[#9B9890]"> / </span>
                      <span className="text-[#D63B1F] font-medium">{c.failed_count || 0}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateVoicemailModal
          phoneNumbers={phoneNumbers}
          contactLists={contactLists}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await load() }}
          onError={(e) => setErrorModal(e)}
          refreshPhoneNumbers={async () => {
            const res = await apiGet('/api/phone-numbers')
            const data = await res.json()
            if (data.success) setPhoneNumbers(data.phoneNumbers || [])
          }}
        />
      )}

      {errorModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70]" onClick={() => setErrorModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">{errorModal.title}</h3>
            </div>
            <div className="px-5 py-4 text-sm text-[#5C5A55]">{errorModal.message}</div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
              <button onClick={() => setErrorModal(null)} className="px-3 py-1.5 text-sm border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateVoicemailModal({ phoneNumbers, contactLists, onClose, onCreated, onError, refreshPhoneNumbers }) {
  const [name, setName] = useState('')
  const [senderNumber, setSenderNumber] = useState('')
  const [recordingUrl, setRecordingUrl] = useState('')
  const [recordingPath, setRecordingPath] = useState('')
  const [voicedropRecordingUrl, setVoicedropRecordingUrl] = useState('')
  const [contactListIds, setContactListIds] = useState([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const selectedPhone = phoneNumbers.find(p => p.phoneNumber === senderNumber)
  const needsVerify = selectedPhone && !selectedPhone.voicedrop_verified

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/voicemail-campaigns/upload-audio', {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) { onError({ title: 'Upload failed', message: data.error || 'Unable to upload' }); return }
      setRecordingUrl(data.url)
      setRecordingPath(data.path)
      setVoicedropRecordingUrl(data.voicedrop_url || '')
    } finally {
      setUploading(false)
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) return onError({ title: 'Missing name', message: 'Give the voicemail a name.' })
    if (!senderNumber) return onError({ title: 'Pick a sender', message: 'Select which number this voicemail comes from.' })
    if (needsVerify) return onError({ title: 'Verify required', message: 'This number must be verified with VoiceDrop first.' })
    if (!recordingUrl) return onError({ title: 'Missing audio', message: 'Upload an mp3 first.' })
    if (contactListIds.length === 0) return onError({ title: 'Pick a list', message: 'Select at least one contact list.' })

    setSubmitting(true)
    try {
      const res = await apiPost('/api/voicemail-campaigns', { name: name.trim(), recordingUrl, recordingPath, voicedropRecordingUrl, senderNumber, contactListIds })
      const data = await res.json()
      if (!res.ok) { onError({ title: 'Create failed', message: data.error || 'Could not create' }); return }
      // Auto-launch
      const startRes = await apiPost(`/api/voicemail-campaigns/${data.campaign.id}/start`, {})
      const startData = await startRes.json()
      if (!startRes.ok) {
        onError({ title: 'Launch failed', message: startData.error || 'Created as draft — could not start.' })
      }
      await onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">New voicemail</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#131210] text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-[12.5px] font-medium text-[#5C5A55] mb-1">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. April reactivation drop"
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:border-[#D63B1F]"
            />
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-[#5C5A55] mb-1">Sender number</label>
            <select
              value={senderNumber}
              onChange={e => setSenderNumber(e.target.value)}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm focus:outline-none focus:border-[#D63B1F]"
            >
              <option value="">Choose a number…</option>
              {phoneNumbers.map(p => (
                <option key={p.id} value={p.phoneNumber}>
                  {p.custom_name ? `${p.custom_name} (${p.phoneNumber})` : p.phoneNumber}{p.voicedrop_verified ? ' ✓' : ''}
                </option>
              ))}
            </select>
            {needsVerify && (
              <VerifyInline
                phoneNumber={senderNumber}
                onVerified={async () => { await refreshPhoneNumbers() }}
                onError={onError}
              />
            )}
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-[#5C5A55] mb-1">Audio file</label>
            {recordingUrl ? (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg">
                <audio src={recordingUrl} controls className="flex-1 h-8" preload="none" />
                <button onClick={() => { setRecordingUrl(''); setRecordingPath('') }} className="text-xs text-[#9B9890] hover:text-[#D63B1F]">Replace</button>
              </div>
            ) : (
              <label className="block px-3 py-6 border-2 border-dashed border-[#D4D1C9] rounded-lg text-center cursor-pointer hover:bg-[#F7F6F3]">
                <input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/flac" onChange={handleFile} className="hidden" disabled={uploading} />
                <p className="text-[13px] text-[#5C5A55]">{uploading ? 'Uploading…' : 'Click to upload mp3 (max 10 MB)'}</p>
              </label>
            )}
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-[#5C5A55] mb-1">Contact lists</label>
            <div className="border border-[#D4D1C9] rounded-lg max-h-40 overflow-y-auto divide-y divide-[#F0EEE9]">
              {contactLists.length === 0 ? (
                <p className="text-xs text-[#9B9890] p-3">No contact lists. Create one first under Contacts.</p>
              ) : contactLists.map(l => (
                <label key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[#F7F6F3]">
                  <input
                    type="checkbox"
                    checked={contactListIds.includes(l.id)}
                    onChange={(e) => setContactListIds(prev => e.target.checked ? [...prev, l.id] : prev.filter(x => x !== l.id))}
                  />
                  <span className="text-[#131210]">{l.name}</span>
                  <span className="text-[11px] text-[#9B9890] ml-auto">{l.contactCount ?? l.contact_count ?? 0}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={submitting || uploading || needsVerify}
            className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50"
          >
            {submitting ? 'Launching…' : 'Create & launch'}
          </button>
        </div>
      </div>
    </div>
  )
}

function VerifyInline({ phoneNumber, onVerified, onError }) {
  const [step, setStep] = useState('idle') // idle | sent | confirming
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCall = async () => {
    setBusy(true)
    try {
      const res = await apiPost('/api/voicedrop/verify-init', { phoneNumber })
      const data = await res.json()
      if (!res.ok) { onError({ title: 'Verification failed', message: data.error || 'Could not place call' }); return }
      setStep('sent')
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    setBusy(true)
    try {
      const res = await apiPost('/api/voicedrop/verify-confirm', { phoneNumber, code })
      const data = await res.json()
      if (!res.ok) { onError({ title: 'Code rejected', message: data.error || 'Invalid code' }); return }
      await onVerified()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-[rgba(214,59,31,0.05)] border border-[rgba(214,59,31,0.2)] rounded-lg">
      <p className="text-[12.5px] text-[#131210] font-medium mb-1">Verify this number with VoiceDrop</p>
      <p className="text-[11.5px] text-[#5C5A55] mb-2.5 leading-relaxed">One-time setup. We&rsquo;ll call this number and read you a code.</p>
      {step === 'idle' && (
        <button onClick={sendCall} disabled={busy} className="px-3 py-1.5 text-xs font-medium text-white bg-[#131210] rounded-md disabled:opacity-50">
          {busy ? 'Calling…' : 'Send verification call'}
        </button>
      )}
      {step === 'sent' && (
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Enter code"
            className="flex-1 px-2.5 py-1.5 text-xs border border-[#D4D1C9] rounded-md focus:outline-none focus:border-[#D63B1F]"
          />
          <button onClick={submitCode} disabled={busy || !code} className="px-3 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded-md disabled:opacity-50">
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      )}
    </div>
  )
}
