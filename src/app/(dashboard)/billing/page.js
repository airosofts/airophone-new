'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import StripeCardForm from '@/components/billing/StripeCardForm'

const PLANS = {
  starter:    { name: 'Starter',    price: 9,  credits: 200,  overage: 0.04, color: '#9B9890', bg: '#EFEDE8' },
  growth:     { name: 'Growth',     price: 29, credits: 500,  overage: 0.03, color: '#D63B1F', bg: 'rgba(214,59,31,0.07)' },
  enterprise: { name: 'Enterprise', price: 59, credits: 1000, overage: 0.02, color: '#16a34a', bg: '#f0fdf4' },
}
//ok
export default function BillingPage() {
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('subscription')
  const [subscription, setSubscription] = useState(null)
  const [credits, setCredits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState([])
  const [savedCards, setSavedCards] = useState([])
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [showAddCardModal, setShowAddCardModal] = useState(false)
  const [errorModal, setErrorModal] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Auto-recharge state
  const [arEnabled, setArEnabled] = useState(false)
  const [arThreshold, setArThreshold] = useState(50)
  const [arAmount, setArAmount] = useState(200)
  const [arSaving, setArSaving] = useState(false)
  const [arSaved, setArSaved] = useState(false)

  useEffect(() => {
    const u = getCurrentUser()
    setUser(u)
    if (u?.userId) {
      fetchAll(u)
    }
  }, [])

  const fetchAll = async (u) => {
    setLoading(true)
    await Promise.all([
      fetchSubscription(u),
      fetchTransactions(u.userId),
      fetchSavedCards(u.userId),
      fetchAutoRecharge(u),
    ])
    setLoading(false)
  }

  const fetchAutoRecharge = async (u) => {
    try {
      const res = await fetch('/api/wallet/auto-recharge', {
        headers: { 'x-workspace-id': u.workspaceId, 'x-user-id': u.userId },
      })
      const data = await res.json()
      if (data.success) {
        setArEnabled(data.enabled)
        setArThreshold(data.threshold)
        setArAmount(data.amount)
      }
    } catch (e) { console.error(e) }
  }

  const saveAutoRecharge = async () => {
    if (!user) return
    setArSaving(true)
    setArSaved(false)
    try {
      const res = await fetch('/api/wallet/auto-recharge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': user.workspaceId, 'x-user-id': user.userId },
        body: JSON.stringify({ enabled: arEnabled, threshold: arThreshold, amount: arAmount }),
      })
      const data = await res.json()
      if (data.success) { setArSaved(true); setTimeout(() => setArSaved(false), 3000) }
      else setErrorModal({ title: 'Save Failed', message: data.error || 'Could not save settings.' })
    } catch { setErrorModal({ title: 'Error', message: 'An unexpected error occurred.' }) }
    finally { setArSaving(false) }
  }

  const fetchSubscription = async (u) => {
    try {
      const res = await fetch('/api/subscription', {
        headers: { 'x-workspace-id': u.workspaceId, 'x-user-id': u.userId },
      })
      const data = await res.json()
      if (data.success) {
        setSubscription(data.subscription)
        setCredits(data.credits ?? 0)
      }
    } catch (e) { console.error(e) }
  }

  const fetchTransactions = async (userId) => {
    try {
      const res = await fetch('/api/transactions', { headers: { 'x-user-id': userId } })
      const data = await res.json()
      if (data.success) setTransactions(data.transactions)
    } catch (e) { console.error(e) }
  }

  const fetchSavedCards = async (userId) => {
    try {
      const res = await fetch('/api/payment-methods', { headers: { 'x-user-id': userId } })
      const data = await res.json()
      if (data.success) setSavedCards(data.cards)
    } catch (e) { console.error(e) }
  }

  const handleCancelSubscription = () => {
    setConfirmModal({
      title: 'Cancel Subscription',
      message: 'Your plan will stay active until the end of the current billing period. You can reactivate anytime before it expires.',
      confirmLabel: 'Yes, cancel',
      confirmClass: 'bg-[#5C5A55] hover:bg-[#131210]',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          const res = await fetch('/api/stripe/cancel-subscription', {
            method: 'POST',
            headers: { 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
          })
          const data = await res.json()
          if (data.success) fetchSubscription(user)
          else setErrorModal({ title: 'Cancel Failed', message: data.error || 'Could not cancel subscription.' })
        } catch { setErrorModal({ title: 'Error', message: 'An unexpected error occurred.' }) }
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const handleReactivateSubscription = async () => {
    try {
      const res = await fetch('/api/stripe/cancel-subscription', {
        method: 'DELETE',
        headers: { 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
      })
      const data = await res.json()
      if (data.success) fetchSubscription(user)
      else setErrorModal({ title: 'Reactivation Failed', message: data.error || 'Could not reactivate.' })
    } catch { setErrorModal({ title: 'Error', message: 'An unexpected error occurred.' }) }
  }

  const handleRemoveCard = (cardId, cardDetails) => {
    setConfirmModal({
      title: 'Remove Payment Method',
      message: `Remove ${cardDetails.brand} •••• ${cardDetails.last4}?`,
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          const res = await fetch(`/api/payment-methods?id=${cardId}`, {
            method: 'DELETE', headers: { 'x-user-id': user?.userId || '' },
          })
          const data = await res.json()
          if (data.success) fetchSavedCards(user.userId)
          else setErrorModal({ title: 'Failed to Remove Card', message: data.error || 'An error occurred.' })
        } catch { setErrorModal({ title: 'Error', message: 'An unexpected error occurred.' }) }
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const formatDateTime = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

  const plan = PLANS[subscription?.plan_name] || null
  const totalPages = Math.ceil(transactions.length / itemsPerPage)
  const currentTransactions = transactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const statusBadge = (status) => {
    const map = {
      trialing: { label: 'Trial', cls: 'bg-[rgba(214,59,31,0.07)] text-[#D63B1F]' },
      active:   { label: 'Active', cls: 'bg-green-50 text-green-700' },
      canceled: { label: 'Canceled', cls: 'bg-red-50 text-red-600' },
      past_due: { label: 'Past due', cls: 'bg-yellow-50 text-yellow-700' },
    }
    return map[status] || { label: status || 'Unknown', cls: 'bg-[#EFEDE8] text-[#9B9890]' }
  }

  return (
    <div className="h-full bg-[#F7F6F3] overflow-auto">
      <div className="p-4 md:p-6">

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[#EFEDE8] rounded-lg w-fit mb-5">
          {[
            { id: 'subscription', label: 'Subscription' },
            { id: 'credits', label: 'Credits' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                tab === t.id
                  ? 'bg-white text-[#131210] shadow-sm'
                  : 'text-[#9B9890] hover:text-[#5C5A55]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── SUBSCRIPTION TAB ── */}
        {tab === 'subscription' && (
          <div className="space-y-4">

            {loading ? (
              <div className="bg-white border border-[#E3E1DB] rounded-lg p-8 text-center">
                <div className="h-4 w-32 bg-[#EFEDE8] rounded animate-pulse mx-auto mb-3" />
                <div className="h-3 w-48 bg-[#EFEDE8] rounded animate-pulse mx-auto" />
              </div>
            ) : !subscription ? (
              <div className="bg-white border border-[#E3E1DB] rounded-lg p-10 text-center">
                <div className="w-10 h-10 rounded-full bg-[#EFEDE8] flex items-center justify-center mx-auto mb-3">
                  <i className="fas fa-receipt text-[#9B9890]"></i>
                </div>
                <p className="text-sm font-medium text-[#131210] mb-1">No active subscription</p>
                <p className="text-xs text-[#9B9890]">Complete onboarding to start your free trial</p>
              </div>
            ) : (
              <>
                {/* Plan card */}
                <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#131210]">Current Plan</h3>
                    {(() => { const s = statusBadge(subscription.status); return (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${s.cls}`}>{s.label}</span>
                    )})()}
                  </div>
                  <div className="px-5 py-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2.5 mb-1">
                          <span className="text-2xl font-semibold text-[#131210]">{plan?.name || subscription.plan_name}</span>
                          <span
                            className="px-2 py-0.5 text-[11px] font-semibold rounded"
                            style={{ background: plan?.bg, color: plan?.color }}
                          >
                            {plan ? `$${plan.price}/mo` : ''}
                          </span>
                        </div>
                        <p className="text-sm text-[#9B9890]">{plan?.credits?.toLocaleString()} credits included per month</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-semibold text-[#131210]">${plan?.price}</p>
                        <p className="text-xs text-[#9B9890]">per month</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-[#E3E1DB]">
                      <div>
                        <p className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-wider mb-1">Included credits</p>
                        <p className="text-sm font-semibold text-[#131210]">{plan?.credits?.toLocaleString()} / mo</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-wider mb-1">Extra credits</p>
                        <p className="text-sm font-semibold text-[#131210]">${plan?.overage} / credit</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-wider mb-1">
                          {subscription.status === 'trialing' ? 'Trial ends' : 'Renews on'}
                        </p>
                        <p className="text-sm font-semibold text-[#131210]">
                          {subscription.status === 'trialing'
                            ? formatDate(subscription.trial_end)
                            : formatDate(subscription.current_period_end)}
                        </p>
                      </div>
                    </div>

                    {subscription.status === 'trialing' && (
                      <div className="mt-4 flex items-center gap-2 px-3 py-2.5 bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.14)] rounded-md text-xs text-[#D63B1F]">
                        <i className="fas fa-clock"></i>
                        Your free trial ends on <strong>{formatDate(subscription.trial_end)}</strong>. You won't be charged until then.
                      </div>
                    )}

                    {subscription.cancel_at_period_end && (
                      <div className="mt-4 flex items-center justify-between px-3 py-2.5 bg-yellow-50 border border-yellow-100 rounded-md text-xs text-yellow-700">
                        <span><i className="fas fa-exclamation-triangle mr-1.5"></i>Cancels on {formatDate(subscription.current_period_end)} — you keep access until then</span>
                        <button
                          onClick={handleReactivateSubscription}
                          className="ml-4 text-xs font-medium text-[#D63B1F] hover:underline whitespace-nowrap">
                          Undo cancellation
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Cancel — kept at bottom, small and unobtrusive */}
                  {!subscription.cancel_at_period_end && subscription.status !== 'canceled' && (
                    <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
                      <button
                        onClick={handleCancelSubscription}
                        className="text-xs text-[#9B9890] hover:text-[#D63B1F] transition-colors">
                        Cancel subscription
                      </button>
                    </div>
                  )}
                </div>

                {/* All plans comparison */}
                <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#E3E1DB]">
                    <h3 className="text-sm font-semibold text-[#131210]">Available Plans</h3>
                    <p className="text-xs text-[#9B9890] mt-0.5">Contact support to change your plan</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#E3E1DB]">
                    {Object.entries(PLANS).map(([key, p]) => {
                      const isCurrent = subscription.plan_name === key
                      return (
                        <div key={key} className={`px-5 py-4 ${isCurrent ? 'bg-[#FDF9F8]' : ''}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-[#131210]">{p.name}</span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-[#D63B1F] text-white">Current</span>
                            )}
                          </div>
                          <p className="text-xl font-semibold text-[#131210] mb-0.5">${p.price}<span className="text-xs font-normal text-[#9B9890]">/mo</span></p>
                          <p className="text-xs text-[#9B9890] mb-3">{p.credits.toLocaleString()} credits included</p>
                          <div className="space-y-1.5">
                            {[
                              `${p.credits.toLocaleString()} credits / month`,
                              `$${p.overage}/extra credit`,
                              'All features included',
                              'Phone number provisioning',
                            ].map(f => (
                              <div key={f} className="flex items-center gap-1.5 text-xs text-[#5C5A55]">
                                <i className="fas fa-check text-[9px]" style={{ color: p.color }}></i>
                                {f}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Payment methods */}
                {savedCards.length > 0 && (
                  <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-[#131210]">Payment Methods</h3>
                      <button onClick={() => setShowAddCardModal(true)}
                        className="text-xs text-[#D63B1F] font-medium hover:underline">
                        + Add card
                      </button>
                    </div>
                    <div className="divide-y divide-[#E3E1DB]">
                      {savedCards.map(card => (
                        <div key={card.id} className="px-5 py-3 flex items-center justify-between hover:bg-[#F7F6F3]">
                          <div className="flex items-center gap-3">
                            <i className={`fab fa-cc-${card.brand?.toLowerCase()} text-2xl text-[#5C5A55]`}></i>
                            <div>
                              <p className="text-sm font-medium text-[#131210]">
                                <span className="capitalize">{card.brand}</span> •••• {card.last4}
                                {card.is_default && <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 rounded">Default</span>}
                              </p>
                              <p className="text-xs text-[#9B9890]">Expires {card.exp_month}/{card.exp_year}</p>
                            </div>
                          </div>
                          <button onClick={() => handleRemoveCard(card.id, { brand: card.brand, last4: card.last4 })}
                            className="px-2.5 py-1.5 text-xs text-[#D63B1F] border border-[rgba(214,59,31,0.14)] rounded hover:bg-[rgba(214,59,31,0.07)]">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── CREDITS TAB ── */}
        {tab === 'credits' && (
          <div className="space-y-4">

            {/* Balance */}
            <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
              <div className="px-4 md:px-5 py-3 md:py-3.5 border-b border-[#E3E1DB]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[#131210]">Available Credits</h3>
                    <p className="text-xs text-[#9B9890] mt-0.5">Used for SMS, calls and AI replies</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setShowAddCardModal(true)}
                      className="px-2.5 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] transition-colors whitespace-nowrap">
                      <i className="fas fa-credit-card mr-1 text-xs"></i>
                      <span className="hidden sm:inline">Add Card</span>
                      <span className="sm:hidden">Card</span>
                    </button>
                    <button onClick={() => setShowTopUpModal(true)}
                      className="px-2.5 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap">
                      <i className="fas fa-plus mr-1 text-xs"></i>
                      <span className="hidden sm:inline">Buy Credits</span>
                      <span className="sm:hidden">Buy</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="px-4 md:px-5 py-4 md:py-5 flex items-end gap-6 flex-wrap">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-[#131210]">{loading ? '—' : Math.round(credits).toLocaleString()}</span>
                    <span className="text-sm text-[#9B9890]">credits</span>
                  </div>
                  <p className="text-xs text-[#9B9890] mt-1">Current balance</p>
                </div>
                {plan && (
                  <div className="pb-0.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-base font-semibold text-[#131210]">{plan.credits.toLocaleString()}</span>
                      <span className="text-xs text-[#9B9890]">credits reset monthly</span>
                    </div>
                    <p className="text-xs text-[#9B9890] mt-1">Included in {plan.name} plan</p>
                  </div>
                )}
              </div>
            </div>

            {/* Auto-recharge */}
            <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#131210]">Auto-Recharge</h3>
                  <p className="text-xs text-[#9B9890] mt-0.5">Automatically buy credits when your balance runs low</p>
                </div>
                {/* Toggle */}
                <button
                  onClick={() => setArEnabled(v => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${arEnabled ? 'bg-[#D63B1F]' : 'bg-[#D4D1C9]'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${arEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className={`px-5 py-4 space-y-4 ${!arEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#5C5A55] mb-1.5 uppercase tracking-wider" style={{ fontSize: '10.5px', letterSpacing: '0.07em' }}>
                      When credits drop below
                    </label>
                    <div className="relative">
                      <input
                        type="number" min="1" step="1"
                        value={arThreshold}
                        onChange={e => setArThreshold(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 pr-16 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9B9890]">credits</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#5C5A55] mb-1.5 uppercase tracking-wider" style={{ fontSize: '10.5px', letterSpacing: '0.07em' }}>
                      Automatically buy
                    </label>
                    <div className="relative">
                      <input
                        type="number" min="1" step="1"
                        value={arAmount}
                        onChange={e => setArAmount(parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 pr-16 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9B9890]">credits</span>
                    </div>
                  </div>
                </div>

                {plan && arAmount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-md text-xs text-[#5C5A55]">
                    <i className="fas fa-info-circle text-[#9B9890]"></i>
                    When your credits drop below <strong className="text-[#131210]">{arThreshold}</strong>, we'll charge{' '}
                    <strong className="text-[#131210]">${(arAmount * plan.overage).toFixed(2)}</strong> to your default card for{' '}
                    <strong className="text-[#131210]">{arAmount} credits</strong> at ${plan.overage}/credit ({plan.name} rate)
                  </div>
                )}

                {savedCards.length === 0 && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-yellow-50 border border-yellow-200 rounded-md text-xs text-yellow-800">
                    <i className="fas fa-exclamation-triangle"></i>
                    Add a payment method first to enable auto-recharge
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
                {arSaved && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <i className="fas fa-check"></i> Settings saved
                  </span>
                )}
                {!arSaved && <span />}
                <button
                  onClick={saveAutoRecharge}
                  disabled={arSaving || savedCards.length === 0}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50 transition-colors"
                >
                  {arSaving ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</> : 'Save settings'}
                </button>
              </div>
            </div>

            {/* Credit pricing — based on plan overage rate */}
            <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E3E1DB]">
                <h3 className="text-sm font-semibold text-[#131210]">Extra Credit Pricing</h3>
                <p className="text-xs text-[#9B9890] mt-0.5">
                  {plan
                    ? `Your ${plan.name} plan rate — upgrade for a lower per-credit price`
                    : 'Rate depends on your subscription plan'}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#E3E1DB]">
                {Object.entries(PLANS).map(([key, p]) => {
                  const isCurrent = subscription?.plan_name === key
                  return (
                    <div key={key} className={`px-5 py-4 ${isCurrent ? 'bg-[#FDF9F8]' : ''}`}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span
                          className="px-2 py-0.5 text-[10px] font-semibold rounded"
                          style={{ background: p.bg, color: p.color }}
                        >
                          {p.name}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-[#D63B1F] text-white">Your plan</span>
                        )}
                      </div>
                      <p className="text-xl font-semibold text-[#131210]">${p.overage}</p>
                      <p className="text-xs text-[#9B9890] mt-0.5">per extra credit</p>
                      <p className="text-xs text-[#9B9890] mt-1.5">{p.credits.toLocaleString()} included free</p>
                    </div>
                  )
                })}
              </div>
              <div className="px-5 py-3 bg-[#F7F6F3] border-t border-[#E3E1DB]">
                <p className="text-xs text-[#9B9890]">
                  <span className="font-medium text-[#5C5A55]">1 SMS = 1 credit</span>
                  <span className="mx-2 text-[#D4D1C9]">•</span>
                  <span className="font-medium text-[#5C5A55]">1 AI reply = 2 credits</span>
                  <span className="mx-2 text-[#D4D1C9]">•</span>
                  <span className="font-medium text-[#5C5A55]">1 min call = 1 credit</span>
                </p>
              </div>
            </div>

            {/* Transaction History */}
            <div className="bg-white border border-[#E3E1DB] rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E3E1DB]">
                <h3 className="text-sm font-semibold text-[#131210]">Transaction History</h3>
              </div>
              {loading ? (
                <div className="px-5 py-8 text-center text-sm text-[#9B9890]">
                  <i className="fas fa-spinner fa-spin mr-2"></i>Loading…
                </div>
              ) : transactions.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-[#9B9890]">No transactions yet</p>
                  <p className="text-xs text-[#9B9890] mt-1">Your credit history will appear here</p>
                </div>
              ) : (
                <>
                  {/* Mobile transaction cards */}
                  <div className="md:hidden divide-y divide-[#E3E1DB]">
                    {currentTransactions.map(tx => {
                      const isCredit = tx.type === 'topup' || tx.type === 'refund'
                      const icon = isCredit ? 'fa-arrow-up' : 'fa-arrow-down'
                      const iconColor = isCredit ? 'text-green-600' : 'text-red-600'
                      const iconBg = isCredit ? 'bg-green-50' : 'bg-red-50'
                      return (
                        <div key={tx.id} className="px-4 py-3.5 flex items-center gap-3">
                          <div className={`w-8 h-8 ${iconBg} rounded-md flex items-center justify-center shrink-0`}>
                            <i className={`fas ${icon} ${iconColor} text-xs`}></i>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#131210] font-medium truncate">{tx.description}</p>
                            <p className="text-xs text-[#9B9890]">{formatDateTime(tx.created_at)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-semibold ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
                              {isCredit ? '+' : '−'}{Math.round(Math.abs(tx.credits ?? tx.amount)).toLocaleString()}
                            </p>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              tx.status === 'completed' ? 'bg-green-50 text-green-700'
                              : tx.status === 'pending' ? 'bg-yellow-50 text-yellow-700'
                              : 'bg-red-50 text-red-700'
                            }`}>
                              {tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1) : 'Unknown'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                          <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Transaction</th>
                          <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Date</th>
                          <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Status</th>
                          <th className="px-5 py-3 text-right text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Credits</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E3E1DB]">
                        {currentTransactions.map(tx => {
                          const isCredit = tx.type === 'topup' || tx.type === 'refund'
                          const icon = isCredit ? 'fa-arrow-up' : 'fa-arrow-down'
                          const iconColor = isCredit ? 'text-green-600' : 'text-red-600'
                          const iconBg = isCredit ? 'bg-green-50' : 'bg-red-50'
                          return (
                            <tr key={tx.id} className="hover:bg-[#F7F6F3]">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-7 h-7 ${iconBg} rounded-md flex items-center justify-center flex-shrink-0`}>
                                    <i className={`fas ${icon} ${iconColor} text-xs`}></i>
                                  </div>
                                  <div>
                                    <p className="text-sm text-[#131210]">{tx.description}</p>
                                    <p className="text-xs text-[#9B9890]">#{tx.id.slice(0, 8)}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-sm text-[#9B9890] whitespace-nowrap">{formatDateTime(tx.created_at)}</td>
                              <td className="px-5 py-3">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  tx.status === 'completed' ? 'bg-green-50 text-green-700'
                                  : tx.status === 'pending' ? 'bg-yellow-50 text-yellow-700'
                                  : 'bg-red-50 text-red-700'
                                }`}>
                                  {tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1) : 'Unknown'}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-right">
                                <span className={`text-sm font-medium ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
                                  {isCredit ? '+' : '−'}{Math.round(Math.abs(tx.credits ?? tx.amount)).toLocaleString()}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>{/* end hidden md:block */}
                  {totalPages > 1 && (
                    <div className="px-5 py-3 border-t border-[#E3E1DB] flex items-center justify-between bg-[#F7F6F3]">
                      <p className="text-xs text-[#9B9890]">
                        {(currentPage-1)*itemsPerPage+1}–{Math.min(currentPage*itemsPerPage, transactions.length)} of {transactions.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1}
                          className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50">
                          <i className="fas fa-angle-left"></i>
                        </button>
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(page => (
                          <button key={page} onClick={() => setCurrentPage(page)}
                            className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                              currentPage === page ? 'bg-[#D63B1F] text-white border-[#D63B1F]' : 'text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3]'
                            }`}>
                            {page}
                          </button>
                        ))}
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages}
                          className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded hover:bg-[#F7F6F3] disabled:opacity-50">
                          <i className="fas fa-angle-right"></i>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {showTopUpModal && (
        <TopUpModal
          onClose={() => setShowTopUpModal(false)}
          savedCards={savedCards}
          user={user}
          planOverage={plan?.overage ?? 0.04}
          planName={plan?.name ?? 'Starter'}
          onSuccess={() => {
            setShowTopUpModal(false)
            if (user) fetchAll(user)
          }}
          onError={(e) => setErrorModal(e)}
        />
      )}

      {showAddCardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Add Payment Method</h3>
              <button onClick={() => setShowAddCardModal(false)} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <div className="px-5 py-4">
              <StripeCardForm
                onClose={() => setShowAddCardModal(false)}
                user={user}
                onSuccess={() => { setShowAddCardModal(false); if (user?.userId) fetchSavedCards(user.userId) }}
                onError={(e) => setErrorModal(e)}
              />
            </div>
          </div>
        </div>
      )}

      {errorModal && <ErrorModal title={errorModal.title} message={errorModal.message} onClose={() => setErrorModal(null)} />}
      {confirmModal && <ConfirmModal title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={confirmModal.onCancel} confirmLabel={confirmModal.confirmLabel} confirmClass={confirmModal.confirmClass} />}
    </div>
  )
}

function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">{title}</h3></div>
        <div className="px-5 py-4"><p className="text-sm text-[#5C5A55]">{message}</p></div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">OK</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = 'Remove', confirmClass = 'bg-[#D63B1F] hover:bg-[#c4351b]' }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#E3E1DB]"><h3 className="text-sm font-semibold text-[#131210]">{title}</h3></div>
        <div className="px-5 py-4"><p className="text-sm text-[#5C5A55]">{message}</p></div>
        <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Keep plan</button>
          <button onClick={onConfirm} className={`px-3 py-1.5 text-sm font-medium text-white rounded-md ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function TopUpModal({ onClose, savedCards, user, planOverage, planName, onSuccess, onError }) {
  const [credits, setCredits] = useState('')
  const [selectedCard, setSelectedCard] = useState(savedCards[0]?.id || '')
  const [loading, setLoading] = useState(false)

  const creditAmount = parseInt(credits) || 0
  const totalCost = (creditAmount * planOverage).toFixed(2)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!credits || creditAmount < 1) {
      onError({ title: 'Invalid Amount', message: 'Enter the number of extra credits to purchase.' })
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/wallet/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user?.userId || '' },
        body: JSON.stringify({ credits: creditAmount, amount: parseFloat(totalCost), payment_method_id: selectedCard }),
      })
      const data = await res.json()
      if (data.success) onSuccess()
      else onError({ title: 'Purchase Failed', message: data.error || 'An error occurred.' })
    } catch { onError({ title: 'Error', message: 'An unexpected error occurred.' }) }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-sm font-semibold text-[#131210]">Buy Extra Credits</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1"><i className="fas fa-times text-sm"></i></button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">

          {/* Rate info */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-md text-xs text-[#5C5A55]">
            <i className="fas fa-tag text-[#D63B1F]"></i>
            Your <strong className="text-[#131210]">{planName}</strong> plan rate:
            <strong className="text-[#131210] ml-auto">${planOverage} / credit</strong>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Number of Credits</label>
            <input
              type="number" required min="1" step="1"
              value={credits}
              onChange={e => setCredits(e.target.value)}
              className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]"
              placeholder="e.g. 500"
            />
          </div>

          {creditAmount > 0 && (
            <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-md px-3 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#5C5A55]">Total cost</span>
                <span className="font-semibold text-[#131210]">${totalCost} USD</span>
              </div>
              <div className="flex items-center justify-between text-xs text-[#9B9890] mt-0.5">
                <span>{creditAmount.toLocaleString()} credits × ${planOverage}</span>
              </div>
            </div>
          )}

          {savedCards.length > 0 ? (
            <div>
              <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Payment Method</label>
              <select value={selectedCard} onChange={e => setSelectedCard(e.target.value)} required
                className="w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]">
                {savedCards.map(card => (
                  <option key={card.id} value={card.id}>{card.brand} •••• {card.last4} — Exp {card.exp_month}/{card.exp_year}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2.5">
              <p className="text-xs text-yellow-800"><i className="fas fa-exclamation-triangle mr-1.5"></i>Please add a payment method first.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
            <button type="submit" disabled={loading || savedCards.length === 0}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
              {loading
                ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Processing…</>
                : `Buy ${creditAmount > 0 ? creditAmount.toLocaleString() : ''} Credits`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
