'use client'

// Full-page create/edit form for an AI scenario. Replaces the old modals.
//   mode='create' → POST /api/scenarios
//   mode='edit'   → PATCH /api/scenarios/[id] (prefilled)

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'
import { ContactRestrictionPicker, InstructionTagBar, fmtBizT, fmtBizDays, _TZLBL } from '@/components/scenarios/shared'

const DEFAULT = {
  name: '', description: '', instructions: '', phoneNumbers: [], contact_list_ids: [],
  enable_followups: false, max_followup_attempts: 3, auto_stop_keywords: 'STOP,UNSUBSCRIBE,CANCEL',
  ai_reply_mode: 'anytime', books_appointments: true,
}

export default function ScenarioForm({ mode, scenarioId }) {
  const router = useRouter()
  const isEdit = mode === 'edit'

  const [form, setForm] = useState(DEFAULT)
  const [individualContacts, setIndividualContacts] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [contactLists, setContactLists] = useState([])
  const [listColumns, setListColumns] = useState([])
  const [wsBiz, setWsBiz] = useState(null)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    apiGet('/api/contact-lists').then(r => r.json()).then(d => setContactLists(d.contactLists || [])).catch(() => {})
    fetchWithWorkspace('/api/phone-numbers').then(r => r.json()).then(d => setPhoneNumbers(d.phoneNumbers || [])).catch(() => {})
    fetchWithWorkspace('/api/workspace/business-hours').then(r => r.json()).then(setWsBiz).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit || !scenarioId) return
    apiGet(`/api/scenarios/${scenarioId}`).then(r => r.json()).then(d => {
      const s = d?.scenario
      if (!s) { setErrors({ submit: 'Scenario not found' }); return }
      setForm({
        name: s.name || '', description: s.description || '', instructions: s.instructions || '',
        phoneNumbers: s.scenario_phone_numbers?.map(x => x.phone_number_id) || [],
        contact_list_ids: s.restrict_to_contact_lists || [],
        enable_followups: s.enable_followups || false,
        max_followup_attempts: s.max_followup_attempts || 3,
        auto_stop_keywords: (s.auto_stop_keywords || ['STOP', 'UNSUBSCRIBE']).join(','),
        ai_reply_mode: s.ai_reply_mode || 'anytime',
        books_appointments: s.books_appointments !== false,
      })
      setIndividualContacts((s.scenario_contacts || []).map(sc => ({ phone: sc.recipient_phone, id: sc.contact_id, label: sc.contacts?.business_name || sc.recipient_phone })))
    }).catch(() => setErrors({ submit: 'Failed to load this scenario.' })).finally(() => setLoading(false))
  }, [isEdit, scenarioId])

  useEffect(() => {
    if (form.contact_list_ids.length === 0) { setListColumns([]); return }
    Promise.all(form.contact_list_ids.map(id => fetchWithWorkspace(`/api/contact-lists/${id}/columns`).then(r => r.json())))
      .then(results => {
        const seen = new Set(), cols = []
        results.forEach(r => (r.columns || []).forEach(col => { if (!seen.has(col.key)) { seen.add(col.key); cols.push(col) } }))
        setListColumns(cols)
      }).catch(() => {})
  }, [form.contact_list_ids])

  const save = async () => {
    setErrors({})
    if (!form.name.trim()) return setErrors({ name: 'Scenario name is required' })
    if (!form.instructions.trim()) return setErrors({ instructions: 'Instructions are required' })
    setSubmitting(true)
    try {
      const keywords = form.auto_stop_keywords.split(',').map(k => k.trim().toUpperCase()).filter(Boolean)
      const payload = {
        name: form.name, description: form.description || null, instructions: form.instructions,
        phoneNumbers: form.phoneNumbers, contact_list_ids: form.contact_list_ids,
        contacts: individualContacts.map(c => ({ phone: c.phone, id: c.id || null })),
        enable_followups: form.enable_followups, max_followup_attempts: form.max_followup_attempts,
        auto_stop_keywords: keywords, ai_reply_mode: form.ai_reply_mode, books_appointments: form.books_appointments,
      }
      const res = isEdit
        ? await fetchWithWorkspace(`/api/scenarios/${scenarioId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiPost('/api/scenarios', payload)
      const data = await res.json()
      if (data.success) router.push('/scenarios')
      else setErrors({ submit: data.error || 'Failed to save scenario' })
    } catch { setErrors({ submit: 'Something went wrong. Please try again.' }) }
    finally { setSubmitting(false) }
  }

  const inp = 'w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]'

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
        <button onClick={() => router.push('/scenarios')} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0"><i className="fas fa-robot text-white text-xs" /></span>
          <p className="text-base font-semibold text-[#131210] truncate">{isEdit ? 'Edit scenario' : 'New scenario'}</p>
        </div>
        <button onClick={() => router.push('/scenarios')} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Cancel</button>
        <button onClick={save} disabled={submitting || loading}
          className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50">
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create scenario'}
        </button>
      </div>

      {errors.submit && (
        <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{errors.submit}</div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-[#9B9890]"><i className="fas fa-spinner fa-spin text-xl" /></div>
        ) : (
          <div className="max-w-5xl mx-auto px-6 py-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
              {/* LEFT */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Scenario Name *</label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g., Real Estate Lead Follow-up" className={inp} />
                  {errors.name && <p className="text-[#D63B1F] text-xs mt-1">{errors.name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Description</label>
                  <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description (optional)" className={inp} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">AI Instructions *</label>
                  <textarea id="scenario-instructions" value={form.instructions} onChange={e => set('instructions', e.target.value)}
                    placeholder="You are a helpful assistant for XYZ company. When a customer messages, respond professionally and…" rows="9"
                    className={`${inp} resize-none`} />
                  <InstructionTagBar taId="scenario-instructions" value={form.instructions} onChange={v => set('instructions', v)} listColumns={listColumns} />
                  {errors.instructions && <p className="text-[#D63B1F] text-xs mt-1">{errors.instructions}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Assign Phone Numbers</label>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto border border-[#E3E1DB] rounded-md p-2 bg-white">
                    {phoneNumbers.length === 0
                      ? <p className="text-xs text-[#9B9890] py-1">No phone numbers available</p>
                      : phoneNumbers.map(pn => (
                        <label key={pn.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.phoneNumbers.includes(pn.id)}
                            onChange={e => set('phoneNumbers', e.target.checked ? [...form.phoneNumbers, pn.id] : form.phoneNumbers.filter(id => id !== pn.id))}
                            className="accent-[#D63B1F]" />
                          <span className="text-sm text-[#5C5A55]">{pn.custom_name || pn.phoneNumber || pn.phone_number}</span>
                        </label>
                      ))}
                  </div>
                </div>
              </div>

              {/* RIGHT */}
              <div className="space-y-4">
                <ContactRestrictionPicker
                  contactLists={contactLists}
                  selectedListIds={form.contact_list_ids}
                  onListToggle={(id, checked) => set('contact_list_ids', checked ? [...form.contact_list_ids, id] : form.contact_list_ids.filter(x => x !== id))}
                  individualContacts={individualContacts}
                  onAddContact={c => setIndividualContacts(p => p.some(x => x.phone === c.phone) ? p : [...p, c])}
                  onRemoveContact={phone => setIndividualContacts(p => p.filter(x => x.phone !== phone))}
                />

                {/* Automatic follow-ups */}
                <div className="border border-[#E3E1DB] rounded-md p-3 space-y-3 bg-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#5C5A55]">Automatic Follow-ups</p>
                      <p className="text-[11px] text-[#9B9890] mt-0.5">Send follow-up messages if no response</p>
                    </div>
                    <button type="button" onClick={() => set('enable_followups', !form.enable_followups)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.enable_followups ? 'bg-[#D63B1F]' : 'bg-[#EFEDE8]'}`}>
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${form.enable_followups ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {form.enable_followups && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Max Attempts</label>
                          <select value={form.max_followup_attempts} onChange={e => set('max_followup_attempts', parseInt(e.target.value))} className={inp}>
                            {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Stop Keywords</label>
                          <input type="text" value={form.auto_stop_keywords} onChange={e => set('auto_stop_keywords', e.target.value)} placeholder="STOP,UNSUBSCRIBE" className={inp} />
                        </div>
                      </div>
                      {isEdit && (
                        <a href={`/scenarios/${scenarioId}/follow-ups`} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D63B1F] hover:underline">
                          <i className="fas fa-layer-group text-[11px]" /> Configure follow-up stages & working hours →
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Business hours (read-only, from Settings) */}
                <div className="border border-[#E3E1DB] rounded-md p-3 bg-[#FBFAF8]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#5C5A55]">Business hours</p>
                    <a href="/settings?section=business-hours" className="text-[11px] text-[#D63B1F] hover:underline whitespace-nowrap">Change in Settings →</a>
                  </div>
                  {wsBiz ? (
                    <p className="text-[13px] text-[#131210] mt-1">{fmtBizDays(wsBiz.days)}, {fmtBizT(wsBiz.start)}–{fmtBizT(wsBiz.end)} <span className="text-[#9B9890]">({_TZLBL[wsBiz.tz] || wsBiz.tz})</span></p>
                  ) : <p className="text-[11px] text-[#9B9890] mt-1">Loading…</p>}
                  <p className="text-[11px] text-[#9B9890] mt-1.5 leading-relaxed">Shared across the workspace. Used for appointment booking and the “only during business hours” reply mode.</p>
                </div>

                {/* Appointment booking */}
                <div className="border border-[#E3E1DB] rounded-md p-3 flex items-center justify-between gap-3 bg-white">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#5C5A55]">Appointment booking</p>
                    <p className="text-[11px] text-[#9B9890] mt-0.5">This scenario books calls — keep confirmed times inside business hours. Turn off for info-only scenarios.</p>
                  </div>
                  <button type="button" onClick={() => set('books_appointments', !form.books_appointments)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.books_appointments ? 'bg-[#D63B1F]' : 'bg-[#EFEDE8]'}`}>
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${form.books_appointments ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* AI reply hours */}
                <div className="border border-[#E3E1DB] rounded-md p-3 bg-white">
                  <p className="text-xs font-semibold text-[#5C5A55]">AI reply hours</p>
                  <p className="text-[11px] text-[#9B9890] mt-0.5 mb-2">When should the AI respond to incoming messages?</p>
                  <select value={form.ai_reply_mode} onChange={e => set('ai_reply_mode', e.target.value)} className={inp}>
                    <option value="anytime">Respond anytime (books within business hours)</option>
                    <option value="business_hours">Only during business hours (defers replies to next opening)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
