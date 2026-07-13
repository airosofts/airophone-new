'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchWithWorkspace } from '@/lib/api-client'
import AutomationBuilder from '../AutomationBuilder'

function BuilderLoader() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  const initialSource = params.get('source') === 'sheets' ? 'sheets' : 'monday'

  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [automation, setAutomation] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const reqs = [fetchWithWorkspace('/api/phone-numbers').then(r => r.json())]
        // No GET-by-id route — fetch the list and pick the row when editing.
        if (editId) reqs.push(fetchWithWorkspace('/api/automations').then(r => r.json()))
        const [pRes, aRes] = await Promise.all(reqs)
        setPhoneNumbers(pRes?.phoneNumbers || [])
        if (editId && aRes?.automations) {
          setAutomation(aRes.automations.find(a => String(a.id) === String(editId)) || null)
        }
      } catch (e) {
        console.error('[automation builder] load failed:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [editId])

  const goBack = () => router.push('/automations')

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#F7F6F3]">
        <p className="text-sm text-[#9B9890]">Loading…</p>
      </div>
    )
  }

  return (
    <AutomationBuilder
      phoneNumbers={phoneNumbers}
      automation={automation}
      initialSource={initialSource}
      onSaved={goBack}
      onCancel={goBack}
    />
  )
}

export default function NewAutomationPage() {
  return (
    <Suspense fallback={<div className="h-full bg-[#F7F6F3]" />}>
      <BuilderLoader />
    </Suspense>
  )
}
