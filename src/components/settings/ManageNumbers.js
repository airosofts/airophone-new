'use client'

import { useState, useEffect, useRef } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost } from '@/lib/api-client'
import { supabase } from '@/lib/supabase'

// Flat credit cost to buy a phone number — kept in sync with lib/pricing.js
const PHONE_NUMBER_CREDIT_COST = 100

export default function ManageNumbers() {
  const [loading, setLoading] = useState(false)
  const [availableNumbers, setAvailableNumbers] = useState([])
  const [myNumbers, setMyNumbers] = useState([])
  const [wallet, setWallet] = useState(null)
  const [user, setUser] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [purchasing, setPurchasing] = useState(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(null)
  const channelRef = useRef(null)
  const syncedRef = useRef(false)
  const [filters, setFilters] = useState({
    country_code: 'US',
    locality: '',
    administrative_area: '',
    national_destination_code: '',
    number_type: '',
    features: [],
    exact_number: '',
  })
  const [searchPerformed, setSearchPerformed] = useState(false)
  const [loadingWallet, setLoadingWallet] = useState(true)
  const [loadingMyNumbers, setLoadingMyNumbers] = useState(true)
  const [confirmPurchase, setConfirmPurchase] = useState(null)
  const [editingNumberId, setEditingNumberId] = useState(null)
  const [editingNumberName, setEditingNumberName] = useState('')
  const [editingNumberPrefix, setEditingNumberPrefix] = useState('')
  const [repairingCalling, setRepairingCalling] = useState(false)
  // Per-number voicemail verification flow: { id, phoneNumber, step:'idle'|'sent', code, busy }
  const [verify, setVerify] = useState(null)

  useEffect(() => {
    const init = async () => {
      const currentUser = getCurrentUser()
      setUser(currentUser)

      await new Promise(resolve => setTimeout(resolve, 100))

      await fetchWallet()
      await fetchMyNumbers()

      // Fetch subscription status
      if (currentUser?.workspaceId) {
        try {
          const res = await fetch('/api/subscription', {
            headers: { 'x-workspace-id': currentUser.workspaceId, 'x-user-id': currentUser.userId },
          })
          const data = await res.json()
          if (data.subscription) setSubscription(data.subscription)
        } catch {}
      }
    }

    init()
  }, [])

  // Realtime subscription — update campaign_status live when Telnyx approves
  useEffect(() => {
    const workspaceId = user?.workspaceId
    if (!workspaceId) return

    if (channelRef.current) supabase.removeChannel(channelRef.current)

    channelRef.current = supabase
      .channel(`manage_numbers_${workspaceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'phone_numbers', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          setMyNumbers(current => current.map(n =>
            n.id === payload.new.id
              ? { ...n, campaign_status: payload.new.campaign_status, status: payload.new.status }
              : n
          ))
        }
      )
      .subscribe()

    return () => {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
    }
  }, [user?.workspaceId])

  const fetchWallet = async () => {
    try {
      console.log('Fetching wallet...')
      const response = await apiGet('/api/wallet')
      const data = await response.json()
      console.log('Wallet response:', data)
      if (data.success) {
        // API returns { success: true, balance: 10.00, currency: 'USD' }
        // Convert to wallet object format
        const walletData = {
          balance: data.balance,
          currency: data.currency
        }
        setWallet(walletData)
        console.log('Wallet set:', walletData)
      } else {
        console.error('Wallet fetch failed:', data.error)
      }
    } catch (error) {
      console.error('Error fetching wallet:', error)
    } finally {
      setLoadingWallet(false)
    }
  }

  const fetchMyNumbers = async () => {
    try {
      const response = await apiGet('/api/phone-numbers')
      const data = await response.json()
      if (data.success) {
        const numbers = data.phoneNumbers || []
        setMyNumbers(numbers)

        // Auto-sync pending numbers from Telnyx (once per session)
        const workspaceId = getCurrentUser()?.workspaceId
        const hasPending = numbers.some(n => n.campaign_status === 'pending')
        if (hasPending && workspaceId && !syncedRef.current) {
          syncedRef.current = true
          fetch('/api/telnyx/sync-campaign-status', {
            method: 'POST',
            headers: { 'x-workspace-id': workspaceId },
          })
            .then(r => r.json())
            .then(result => {
              if (result.synced > 0) {
                apiGet('/api/phone-numbers').then(r => r.json()).then(d => {
                  if (d.success) setMyNumbers(d.phoneNumbers || [])
                }).catch(() => {})
              }
            })
            .catch(() => {})
        }
      }
    } catch (error) {
      console.error('Error fetching my numbers:', error)
    } finally {
      setLoadingMyNumbers(false)
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const searchNumbers = async () => {
    setLoading(true)
    setSearchPerformed(true)
    try {
      const queryParams = new URLSearchParams()

      // If exact number is provided, use only that
      if (filters.exact_number.trim()) {
        queryParams.append('exact_number', filters.exact_number.trim())
      } else {
        Object.keys(filters).forEach(key => {
          if (key === 'exact_number') return
          if (filters[key]) {
            if (key === 'features' && filters[key].length > 0) {
              filters[key].forEach(feature => queryParams.append(key, feature))
            } else if (key !== 'features') {
              queryParams.append(key, filters[key])
            }
          }
        })
      }

      const response = await fetch(`/api/telnyx/search-numbers?${queryParams}`)
      const data = await response.json()

      if (data.success) {
        setAvailableNumbers(data.numbers || [])
      } else {
        console.error('Error searching numbers:', data.error)
        setAvailableNumbers([])
      }
    } catch (error) {
      console.error('Error searching numbers:', error)
      setAvailableNumbers([])
    } finally {
      setLoading(false)
    }
  }

  const handlePurchase = async (number) => {
    // Block trial accounts from purchasing numbers
    if (subscription?.status === 'trialing') {
      setShowError({
        title: 'Trial Limitation',
        message: 'Phone number purchases are not available on a free trial. Activate your paid plan to add numbers.',
        action: 'upgrade'
      })
      return
    }

    // Flat 100 credits per phone number (charged against wallet.credits)
    const creditsCost = PHONE_NUMBER_CREDIT_COST
    const availableCredits = Number(wallet?.credits ?? wallet?.balance ?? 0)

    if (availableCredits < creditsCost) {
      setShowError({
        title: 'Insufficient Credits',
        message: `You need ${creditsCost} credits to purchase this number. You have ${availableCredits} credits.`,
        action: 'topup',
      })
      return
    }

    setConfirmPurchase({
      number,
      creditsCost,
    })
  }

  const confirmPurchaseAction = async () => {
    const { number, creditsCost } = confirmPurchase

    setConfirmPurchase(null)
    setPurchasing(number.phone_number)
    setShowError(null)

    try {
      const response = await fetch('/api/telnyx/purchase-number', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.userId,
          'x-workspace-id': user.workspaceId,
          'x-messaging-profile-id': user.messagingProfileId || '',
        },
        body: JSON.stringify({
          phoneNumber: number.phone_number,
          creditsCost,
        }),
      })

      const data = await response.json()

      if (data.success) {
        // Success!
        setShowSuccess(true)

        // Refresh wallet and my numbers
        await fetchWallet()
        await fetchMyNumbers()

        // Remove from available numbers
        setAvailableNumbers(prev =>
          prev.filter(n => n.phone_number !== number.phone_number)
        )

        // Hide success message after 5 seconds
        setTimeout(() => setShowSuccess(false), 5000)
      } else {
        // Telnyx code 10027 = "We don't recognize the number(s)". In practice
        // this means the number was sold to someone else or rotated out of
        // their inventory in the seconds between listing and click. Drop it
        // from the local list so the user doesn't retry the same one. No
        // credits were charged — the Telnyx purchase fails before deduction.
        const telnyxCode = Array.isArray(data.details) ? data.details[0]?.code : null
        if (telnyxCode === '10027') {
          setAvailableNumbers(prev =>
            prev.filter(n => n.phone_number !== number.phone_number)
          )
          setShowError({
            title: 'Number No Longer Available',
            message: `${formatPhoneNumber(number.phone_number)} was taken or removed from Telnyx's inventory just now. Please try a different number.`,
          })
        } else {
          setShowError({
            title: 'Purchase Failed',
            message: data.error || data.message || 'Failed to purchase number',
            details: data.details
          })
        }
      }
    } catch (error) {
      console.error('Purchase error:', error)
      setShowError({
        title: 'Purchase Error',
        message: error.message || 'An error occurred while purchasing the number'
      })
    } finally {
      setPurchasing(null)
    }
  }

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits

    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const startEditingNumber = (number) => {
    setEditingNumberId(number.id)
    setEditingNumberName(number.custom_name || '')
    setEditingNumberPrefix(number.prefix || '')
  }

  const cancelEditingNumber = () => {
    setEditingNumberId(null)
    setEditingNumberName('')
    setEditingNumberPrefix('')
  }

  // Per-line AI auto-reply switch. Optimistic toggle, reverts on error.
  const toggleNumberAi = async (number) => {
    const next = number.ai_enabled === false   // currently off → turn on, else off
    setMyNumbers(prev => prev.map(n => n.id === number.id ? { ...n, ai_enabled: next } : n))
    try {
      const res = await fetch('/api/phone-numbers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.userId,
          'x-workspace-id': user.workspaceId,
          'x-messaging-profile-id': user.messagingProfileId || '',
        },
        body: JSON.stringify({ phoneNumberId: number.id, aiEnabled: next }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed')
    } catch (e) {
      setMyNumbers(prev => prev.map(n => n.id === number.id ? { ...n, ai_enabled: !next } : n))
      setShowError({ title: 'Update Failed', message: e.message || 'Could not change AI setting' })
    }
  }

  const saveCustomName = async (numberId) => {
    try {
      const response = await fetch('/api/phone-numbers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.userId,
          'x-workspace-id': user.workspaceId,
          'x-messaging-profile-id': user.messagingProfileId || ''
        },
        body: JSON.stringify({
          phoneNumberId: numberId,
          customName: editingNumberName.trim() || null,
          prefix: editingNumberPrefix.trim() || null
        })
      })

      const data = await response.json()

      if (data.success) {
        setMyNumbers(prev => prev.map(num =>
          num.id === numberId
            ? { ...num, custom_name: editingNumberName.trim() || null, prefix: editingNumberPrefix.trim() || null }
            : num
        ))
        setEditingNumberId(null)
        setEditingNumberName('')
        setEditingNumberPrefix('')
      } else {
        setShowError({
          title: 'Update Failed',
          message: data.error || 'Failed to update'
        })
      }
    } catch (error) {
      console.error('Error saving:', error)
      setShowError({
        title: 'Update Error',
        message: error.message || 'An error occurred while saving'
      })
    }
  }

  // ── Voicemail (ringless) number verification ──────────────────────────────
  // One-time per number: place an automated call that reads a code, then the
  // user types it back to prove they own the line. On success the number is
  // flagged so it can be used as a sender for voicemail campaigns.
  const startVerify = (number) =>
    setVerify({ id: number.id, phoneNumber: number.phoneNumber, step: 'idle', code: '', busy: false })

  const sendVerifyCall = async () => {
    setVerify(v => ({ ...v, busy: true }))
    try {
      const res = await apiPost('/api/voicedrop/verify-init', { phoneNumber: verify.phoneNumber })
      const data = await res.json()
      if (!res.ok) {
        setShowError({ title: 'Verification failed', message: data.error || 'Could not place the verification call.' })
        setVerify(v => ({ ...v, busy: false }))
        return
      }
      setVerify(v => ({ ...v, step: 'sent', busy: false }))
    } catch {
      setShowError({ title: 'Verification failed', message: 'Could not place the verification call. Please try again.' })
      setVerify(v => ({ ...v, busy: false }))
    }
  }

  const submitVerifyCode = async () => {
    setVerify(v => ({ ...v, busy: true }))
    try {
      const res = await apiPost('/api/voicedrop/verify-confirm', { phoneNumber: verify.phoneNumber, code: verify.code.trim() })
      const data = await res.json()
      if (!res.ok) {
        setShowError({ title: 'Code rejected', message: data.error || 'That code was not correct.' })
        setVerify(v => ({ ...v, busy: false }))
        return
      }
      const verifiedId = verify.id
      setMyNumbers(prev => prev.map(n => n.id === verifiedId ? { ...n, voicedrop_verified: true } : n))
      setVerify(null)
      await fetchMyNumbers()
    } catch {
      setShowError({ title: 'Verification failed', message: 'Could not verify the code. Please try again.' })
      setVerify(v => ({ ...v, busy: false }))
    }
  }

  const handleRepairCalling = async () => {
    setRepairingCalling(true)
    try {
      const currentUser = user || getCurrentUser()
      const headers = {
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.userId || '',
        'x-workspace-id': currentUser?.workspaceId || '',
        'x-messaging-profile-id': currentUser?.messagingProfileId || '',
      }

      // Step 1: Configure messaging profile webhook URL (fixes inbound SMS)
      const webhookRes = await fetch('/api/telnyx/setup-webhooks', { method: 'POST', headers })
      const webhookData = await webhookRes.json()

      // Step 2: Re-provision SIP credential connection (fixes outbound calling)
      const sipRes = await fetch('/api/workspace/sip-credentials', { method: 'POST', headers })
      const sipData = await sipRes.json()

      const smsFixed = webhookData.results?.some(r => r.status === 'updated')
      const callingFixed = sipData.success

      if (smsFixed || callingFixed) {
        setShowError({
          title: 'Repair Complete',
          message: [
            smsFixed ? `SMS webhooks configured → ${webhookData.webhookUrl}` : 'SMS webhook: no profiles updated',
            callingFixed
              ? `Calling repaired (${(sipData.numbersReassigned || []).filter(n => n.status === 'reassigned').length} numbers reassigned)`
              : `Calling repair failed: ${sipData.error || 'unknown error'}`,
            'Refresh the page to reconnect.'
          ].join('\n')
        })
      } else {
        setShowError({
          title: 'Repair Issues',
          message: `SMS: ${webhookData.error || JSON.stringify(webhookData.results)}\nCalling: ${sipData.error || 'failed'}`
        })
      }
    } catch (e) {
      setShowError({ title: 'Repair Error', message: e.message })
    } finally {
      setRepairingCalling(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Success Toast */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50">
          <div className="bg-[#131210] text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 text-sm">
            <i className="fas fa-check-circle text-green-400"></i>
            <span>Number purchased — ready to use</span>
            <button onClick={() => setShowSuccess(false)} className="ml-2 text-[#9B9890] hover:text-white">
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmPurchase && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Confirm Purchase</h3>
              <p className="text-sm text-[#9B9890] mt-0.5 font-mono">{formatPhoneNumber(confirmPurchase.number.phone_number)}</p>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm">
              <div className="flex justify-between text-[#5C5A55]"><span>Phone number (monthly)</span><span>{confirmPurchase.creditsCost} credits</span></div>
              <div className="flex justify-between font-semibold text-[#131210] pt-2 border-t border-[#E3E1DB]">
                <span>Charged now</span><span>{confirmPurchase.creditsCost} credits</span>
              </div>
              <p className="text-xs text-[#9B9890] pt-1">Recurring — 100 credits every 30 days. Cancel anytime and the number is released.</p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              <button onClick={() => setConfirmPurchase(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={confirmPurchaseAction} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">Confirm Purchase</button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {showError && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[#FFFFFF] rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">{showError.title}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">{showError.message}</p>
              {showError.details && (
                <pre className="mt-3 text-xs text-[#9B9890] bg-[#F7F6F3] p-3 rounded font-mono overflow-auto">
                  {JSON.stringify(showError.details, null, 2)}
                </pre>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              {showError.action === 'topup' && (
                <button onClick={() => { setShowError(null); window.location.href = '/billing' }}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">
                  Go to Billing
                </button>
              )}
              {showError.action === 'upgrade' && (
                <button onClick={() => { setShowError(null); window.location.href = '/billing' }}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">
                  Activate Paid Plan
                </button>
              )}
              <button onClick={() => setShowError(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* My Phone Numbers */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-[#131210]">Phone Numbers</h3>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {subscription?.status === 'trialing' && (
              <span className="text-xs text-[#9B9890] bg-[#F7F6F3] border border-[#E3E1DB] px-2 py-0.5 rounded">
                Trial: 1 max
              </span>
            )}
            {!loadingMyNumbers && myNumbers.length > 0 && (
              <span className="text-xs text-[#9B9890]">{myNumbers.length} number{myNumbers.length !== 1 ? 's' : ''}</span>
            )}
            <button
              onClick={handleRepairCalling}
              disabled={repairingCalling}
              title="Fix inbound SMS and outbound calling if they aren't working"
              className="text-xs text-[#9B9890] hover:text-[#5C5A55] flex items-center gap-1 px-2 py-0.5 border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] transition-colors whitespace-nowrap"
            >
              {repairingCalling ? (
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/></svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              )}
              <span className="hidden sm:inline">Repair SMS & Calling</span>
              <span className="sm:hidden">Repair</span>
            </button>
          </div>
        </div>
        {myNumbers.some(n => n.campaign_status === 'pending') && (
          <div className="px-5 py-2.5 bg-[#FFF8E6] border-b border-[#F5D87A] flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" className="shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="text-xs text-[#92400E]">
              One or more numbers are pending 10DLC carrier approval. SMS delivery may be limited — this usually resolves within a few hours.
            </span>
          </div>
        )}
        {loadingMyNumbers ? (
          <div className="px-5 py-4 space-y-3">
            {[1,2].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-2 h-2 bg-[#EFEDE8] rounded-full animate-pulse" />
                <div className="h-4 bg-[#EFEDE8] rounded w-40 animate-pulse" />
                <div className="h-3 bg-[#EFEDE8] rounded w-24 animate-pulse ml-auto" />
              </div>
            ))}
          </div>
        ) : myNumbers.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-[#9B9890]">No phone numbers yet</p>
            <p className="text-xs text-[#9B9890] mt-1">Search and purchase a number below</p>
          </div>
        ) : (
          <div className="divide-y divide-[#E3E1DB]">
            {myNumbers.map((number, index) => {
              const isEditing = editingNumberId === number.id
              return (
                <div key={index}>
                <div className="px-5 py-3 flex items-center gap-4 hover:bg-[#F7F6F3]">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    number.campaign_status === 'rejected' ? 'bg-red-500' :
                    number.campaign_status === 'pending' ? 'bg-yellow-400' :
                    number.status === 'active' ? 'bg-green-500' : 'bg-[#D4D1C9]'
                  }`} />
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={editingNumberName}
                          onChange={(e) => setEditingNumberName(e.target.value)}
                          placeholder="Custom name (e.g., California Office)"
                          className="flex-1 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editingNumberPrefix}
                          onChange={(e) => setEditingNumberPrefix(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="Prefix e.g. 217615"
                          maxLength={6}
                          className="w-full sm:w-36 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                        />
                      </div>
                    ) : (
                      <div>
                        {number.custom_name && <p className="text-sm font-medium text-[#131210]">{number.custom_name}</p>}
                        <p className={`font-mono text-sm ${number.custom_name ? 'text-[#9B9890]' : 'text-[#131210] font-medium'}`}>
                          {formatPhoneNumber(number.phoneNumber)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Prefix column — hidden on mobile */}
                  {!isEditing && (
                    <div className="hidden sm:block w-24 shrink-0">
                      {number.prefix ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono font-medium">
                          {number.prefix}
                        </span>
                      ) : (
                        <span className="text-xs text-[#D4D1C9]">—</span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${number.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-[#EFEDE8] text-[#9B9890]'}`}>
                      {number.status}
                    </span>
                    {number.campaign_status && (
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        number.campaign_status === 'approved' ? 'bg-green-50 text-green-700' :
                        number.campaign_status === 'rejected' ? 'bg-red-50 text-red-600' :
                        'bg-yellow-50 text-yellow-700'
                      }`}>
                        10DLC: {number.campaign_status}
                      </span>
                    )}
                    {number.next_billing_at && (() => {
                      const days = Math.ceil((new Date(number.next_billing_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                      const overdue = days <= 0
                      const soon = days > 0 && days <= 3
                      const label = overdue
                        ? 'Renews today'
                        : days === 1 ? 'Renews in 1 day'
                        : `Renews in ${days} days`
                      return (
                        <span
                          title={`100 credits will be deducted on ${new Date(number.next_billing_at).toLocaleDateString()}`}
                          className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                            overdue ? 'bg-red-50 text-red-600'
                            : soon ? 'bg-yellow-50 text-yellow-700'
                            : 'bg-[#F7F6F3] text-[#5C5A55]'
                          }`}
                        >
                          {label} · 100 credits
                        </span>
                      )
                    })()}
                    {!isEditing && (
                      number.voicedrop_verified ? (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-green-50 text-green-700 font-medium" title="Verified for ringless voicemail">
                          <i className="fas fa-microphone mr-1"></i>Voicemail ready
                        </span>
                      ) : (
                        <button
                          onClick={() => startVerify(number)}
                          className="px-2 py-0.5 text-xs rounded-full border border-[rgba(214,59,31,0.3)] text-[#D63B1F] hover:bg-[rgba(214,59,31,0.06)] font-medium"
                          title="Verify this number so it can send ringless voicemails"
                        >
                          <i className="fas fa-microphone mr-1"></i>Verify for voicemail
                        </button>
                      )
                    )}
                    {!isEditing && (
                      <button
                        onClick={() => toggleNumberAi(number)}
                        title={number.ai_enabled === false ? 'AI auto-reply is OFF for this line — a human handles it' : 'AI auto-reply is ON for this line'}
                        className={`px-2 py-0.5 text-xs rounded-full font-medium border ${number.ai_enabled === false
                          ? 'border-[#E3E1DB] text-[#9B9890] hover:bg-[#F7F6F3]'
                          : 'border-transparent bg-[rgba(31,140,74,0.08)] text-[#1F8C4A] hover:bg-[rgba(31,140,74,0.14)]'}`}
                      >
                        <i className="fas fa-robot mr-1" />AI {number.ai_enabled === false ? 'off' : 'on'}
                      </button>
                    )}
                    {isEditing ? (
                      <div className="flex gap-1.5">
                        <button onClick={() => saveCustomName(number.id)} className="px-2.5 py-1 text-xs font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded">Save</button>
                        <button onClick={cancelEditingNumber} className="px-2.5 py-1 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3]">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEditingNumber(number)} className="text-xs text-[#9B9890] hover:text-[#5C5A55]">
                        <i className="fas fa-pen mr-1"></i>Edit
                      </button>
                    )}
                  </div>
                </div>

                {/* Voicemail verification panel */}
                {verify?.id === number.id && (
                  <div className="px-5 pb-3.5 bg-[#F7F6F3] border-t border-[#EFEDE8]">
                    <div className="mt-3 p-3 bg-[rgba(214,59,31,0.05)] border border-[rgba(214,59,31,0.2)] rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[12.5px] text-[#131210] font-medium">Verify this number for voicemail</p>
                        <button onClick={() => setVerify(null)} className="text-xs text-[#9B9890] hover:text-[#5C5A55]">Cancel</button>
                      </div>
                      <p className="text-[11.5px] text-[#5C5A55] mb-2.5 leading-relaxed">
                        One-time setup. We&rsquo;ll place an automated call to <span className="font-mono">{formatPhoneNumber(number.phoneNumber)}</span> that reads you a code — enter it below.
                      </p>
                      {verify.step === 'idle' && (
                        <button
                          onClick={sendVerifyCall}
                          disabled={verify.busy}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-[#131210] rounded-md disabled:opacity-50"
                        >
                          {verify.busy ? 'Calling…' : 'Send verification call'}
                        </button>
                      )}
                      {verify.step === 'sent' && (
                        <div className="flex gap-2">
                          <input
                            value={verify.code}
                            onChange={(e) => setVerify(v => ({ ...v, code: e.target.value }))}
                            placeholder="Enter code"
                            className="flex-1 max-w-[180px] px-2.5 py-1.5 text-xs border border-[#D4D1C9] rounded-md focus:outline-none focus:border-[#D63B1F]"
                          />
                          <button
                            onClick={submitVerifyCode}
                            disabled={verify.busy || !verify.code.trim()}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded-md disabled:opacity-50"
                          >
                            {verify.busy ? 'Verifying…' : 'Verify'}
                          </button>
                          <button
                            onClick={sendVerifyCall}
                            disabled={verify.busy}
                            className="px-2.5 py-1.5 text-xs text-[#5C5A55] hover:text-[#131210]"
                          >
                            Resend
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Search Filters */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">Search Available Numbers</h3>
        </div>
        <div className="px-5 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Country</label>
            <div className="px-3 py-2 border border-[#E3E1DB] rounded-md bg-[#F7F6F3] text-sm text-[#9B9890]">
              United States
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Area Code</label>
            <input
              type="text"
              value={filters.national_destination_code}
              onChange={(e) => handleFilterChange('national_destination_code', e.target.value.replace(/\D/g, ''))}
              placeholder="e.g., 212, 415"
              maxLength="3"
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">State</label>
            <select
              value={filters.administrative_area}
              onChange={(e) => handleFilterChange('administrative_area', e.target.value)}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F] bg-[#FFFFFF]"
            >
              <option value="">All States</option>
              <option value="AL">Alabama</option>
              <option value="AK">Alaska</option>
              <option value="AZ">Arizona</option>
              <option value="AR">Arkansas</option>
              <option value="CA">California</option>
              <option value="CO">Colorado</option>
              <option value="CT">Connecticut</option>
              <option value="DE">Delaware</option>
              <option value="FL">Florida</option>
              <option value="GA">Georgia</option>
              <option value="HI">Hawaii</option>
              <option value="ID">Idaho</option>
              <option value="IL">Illinois</option>
              <option value="IN">Indiana</option>
              <option value="IA">Iowa</option>
              <option value="KS">Kansas</option>
              <option value="KY">Kentucky</option>
              <option value="LA">Louisiana</option>
              <option value="ME">Maine</option>
              <option value="MD">Maryland</option>
              <option value="MA">Massachusetts</option>
              <option value="MI">Michigan</option>
              <option value="MN">Minnesota</option>
              <option value="MS">Mississippi</option>
              <option value="MO">Missouri</option>
              <option value="MT">Montana</option>
              <option value="NE">Nebraska</option>
              <option value="NV">Nevada</option>
              <option value="NH">New Hampshire</option>
              <option value="NJ">New Jersey</option>
              <option value="NM">New Mexico</option>
              <option value="NY">New York</option>
              <option value="NC">North Carolina</option>
              <option value="ND">North Dakota</option>
              <option value="OH">Ohio</option>
              <option value="OK">Oklahoma</option>
              <option value="OR">Oregon</option>
              <option value="PA">Pennsylvania</option>
              <option value="RI">Rhode Island</option>
              <option value="SC">South Carolina</option>
              <option value="SD">South Dakota</option>
              <option value="TN">Tennessee</option>
              <option value="TX">Texas</option>
              <option value="UT">Utah</option>
              <option value="VT">Vermont</option>
              <option value="VA">Virginia</option>
              <option value="WA">Washington</option>
              <option value="WV">West Virginia</option>
              <option value="WI">Wisconsin</option>
              <option value="WY">Wyoming</option>
              <option value="DC">District of Columbia</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">City</label>
            <input
              type="text"
              value={filters.locality}
              onChange={(e) => handleFilterChange('locality', e.target.value)}
              placeholder="e.g., Miami, Dallas"
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
            />
          </div>
        </div>

        {/* Exact number search */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-[#EFEDE8]" />
          <span className="text-xs text-[#9B9890] whitespace-nowrap">or search exact number</span>
          <div className="flex-1 h-px bg-[#EFEDE8]" />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Number prefix or exact number</label>
          <input
            type="text"
            value={filters.exact_number}
            onChange={(e) => handleFilterChange('exact_number', e.target.value)}
            placeholder="e.g., 212555 or +12125551234"
            className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
          />
          {filters.exact_number && (
            <p className="text-xs text-[#9B9890] mt-1">
              <i className="fas fa-info-circle mr-1"></i>
              Enter first 6+ digits to browse a range, or full number to check availability
            </p>
          )}
        </div>

        <button
          onClick={searchNumbers}
          disabled={loading}
          className="px-4 py-2 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Searching…</> : <><i className="fas fa-search mr-1.5"></i>Search Numbers</>}
        </button>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#131210]">Available Numbers</h3>
            {!loading && <span className="text-xs text-[#9B9890]">{availableNumbers.length} found</span>}
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-[#9B9890]">
              <i className="fas fa-spinner fa-spin mr-2"></i>Searching…
            </div>
          ) : availableNumbers.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[#9B9890]">No numbers found</p>
              <p className="text-xs text-[#9B9890] mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E3E1DB]">
              {availableNumbers.map((number, index) => {
                const creditsCost = PHONE_NUMBER_CREDIT_COST
                const isPurchasing = purchasing === number.phone_number
                const availableCredits = Number(wallet?.credits ?? wallet?.balance ?? 0)
                const canAfford = availableCredits >= creditsCost

                return (
                  <div key={index} className="px-5 py-3 flex items-center gap-4 hover:bg-[#F7F6F3]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#131210] font-mono">{formatPhoneNumber(number.phone_number)}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-[#9B9890]">{number.locality}, {number.administrative_area}</span>
                        <div className="flex gap-1">
                          {number.features?.voice && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">Voice</span>}
                          {number.features?.sms && <span className="px-1.5 py-0.5 bg-green-50 text-green-600 text-[10px] font-medium rounded">SMS</span>}
                          {number.features?.mms && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[10px] font-medium rounded">MMS</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-[#131210]">{creditsCost} credits</p>
                        <p className="text-[10px] text-[#9B9890] hidden sm:block">per month</p>
                      </div>
                      <button
                        onClick={() => handlePurchase(number)}
                        disabled={isPurchasing || !canAfford}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                          isPurchasing ? 'bg-[#EFEDE8] text-[#9B9890] cursor-wait'
                          : canAfford ? 'bg-[#D63B1F] hover:bg-[#c23119] text-white'
                          : 'bg-[#EFEDE8] text-[#9B9890] cursor-not-allowed'
                        }`}
                      >
                        {isPurchasing ? <><i className="fas fa-spinner fa-spin mr-1"></i>Buying…</>
                          : canAfford ? 'Buy'
                          : 'Not enough credits'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
