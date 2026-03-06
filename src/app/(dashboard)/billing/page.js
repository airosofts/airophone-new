'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import StripeCardForm from '@/components/billing/StripeCardForm'

const CREDIT_PRICING_TIERS = [
  { min: 10001, max: Infinity, rate: 0.02, label: '10,000+ credits', description: 'Best value' },
  { min: 5001, max: 10000, rate: 0.025, label: '5,001–10,000 credits', description: 'Popular' },
  { min: 10, max: 5000, rate: 0.03, label: '10–5,000 credits', description: 'Starter' },
]

const getCreditRate = (creditAmount) => {
  const amount = parseInt(creditAmount) || 0
  for (const tier of CREDIT_PRICING_TIERS) {
    if (amount >= tier.min && amount <= tier.max) return tier.rate
  }
  return CREDIT_PRICING_TIERS[CREDIT_PRICING_TIERS.length - 1].rate
}

const calculateCreditCost = (creditAmount) => {
  const amount = parseInt(creditAmount) || 0
  return (amount * getCreditRate(amount)).toFixed(2)
}

export default function BillingPage() {
  const [user, setUser] = useState(null)
  const [walletBalance, setWalletBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState([])
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [showAddCardModal, setShowAddCardModal] = useState(false)
  const [savedCards, setSavedCards] = useState([])
  const [errorModal, setErrorModal] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)

  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    if (currentUser?.userId) {
      fetchWalletData(currentUser.userId, currentUser.workspaceId)
      fetchTransactions(currentUser.userId, currentUser.workspaceId)
      fetchSavedCards(currentUser.userId)
    }
  }, [])

  const fetchWalletData = async (userId, workspaceId) => {
    try {
      setLoading(true)
      const headers = { 'x-user-id': userId }
      if (workspaceId) headers['x-workspace-id'] = workspaceId
      const response = await fetch('/api/wallet', { headers })
      const data = await response.json()
      if (data.success) setWalletBalance(data.balance)
    } catch (error) {
      console.error('Error fetching wallet data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTransactions = async (userId, workspaceId) => {
    try {
      const headers = { 'x-user-id': userId }
      if (workspaceId) headers['x-workspace-id'] = workspaceId
      const response = await fetch('/api/transactions', { headers })
      const data = await response.json()
      if (data.success) setTransactions(data.transactions)
    } catch (error) {
      console.error('Error fetching transactions:', error)
    }
  }

  const fetchSavedCards = async (userId) => {
    try {
      const response = await fetch('/api/payment-methods', { headers: { 'x-user-id': userId } })
      const data = await response.json()
      if (data.success) setSavedCards(data.cards)
    } catch (error) {
      console.error('Error fetching saved cards:', error)
    }
  }

  const handleRemoveCard = (cardId, cardDetails) => {
    setConfirmModal({
      title: 'Remove Payment Method',
      message: `Remove ${cardDetails.brand} •••• ${cardDetails.last4}?`,
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          const response = await fetch(`/api/payment-methods?id=${cardId}`, {
            method: 'DELETE',
            headers: { 'x-user-id': user?.userId || '' },
          })
          const data = await response.json()
          if (data.success) {
            if (user?.userId) fetchSavedCards(user.userId)
          } else {
            setErrorModal({ title: 'Failed to Remove Card', message: data.error || 'An error occurred.' })
          }
        } catch {
          setErrorModal({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
        }
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })

  const getTransactionBadge = (type) => {
    switch (type) {
      case 'topup': return { icon: 'fa-arrow-up', color: 'text-green-600', bg: 'bg-green-50' }
      case 'deduction': return { icon: 'fa-arrow-down', color: 'text-red-600', bg: 'bg-red-50' }
      case 'refund': return { icon: 'fa-undo', color: 'text-blue-600', bg: 'bg-blue-50' }
      default: return { icon: 'fa-circle', color: 'text-gray-500', bg: 'bg-gray-50' }
    }
  }

  const totalPages = Math.ceil(transactions.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentTransactions = transactions.slice(startIndex, startIndex + itemsPerPage)

  return (
    <div className="h-full bg-gray-50 overflow-auto">
      <div className="p-6 space-y-4">

        {/* Balance Card */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Available Credits</h3>
              <p className="text-xs text-gray-400 mt-0.5">Used for sending SMS messages</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddCardModal(true)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                <i className="fas fa-credit-card mr-1.5 text-xs"></i>
                Add Card
              </button>
              <button
                onClick={() => setShowTopUpModal(true)}
                className="px-3 py-1.5 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors"
              >
                <i className="fas fa-plus mr-1.5 text-xs"></i>
                Buy Credits
              </button>
            </div>
          </div>
          <div className="px-5 py-5">
            {loading ? (
              <div className="flex items-center gap-3">
                <div className="h-8 w-24 bg-gray-100 rounded animate-pulse"></div>
                <div className="h-4 w-16 bg-gray-100 rounded animate-pulse"></div>
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-gray-900">{walletBalance.toLocaleString()}</span>
                <span className="text-sm text-gray-400">credits</span>
              </div>
            )}
          </div>
        </div>

        {/* Pricing Tiers */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Message Pricing</h3>
            <p className="text-xs text-gray-400 mt-0.5">Rate per SMS/MMS — automatically decreases as volume grows</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            {[
              { label: '0 – 5,000', rate: '$0.03', tag: 'Starter', tagColor: 'text-gray-500 bg-gray-100' },
              { label: '5,001 – 10,000', rate: '$0.025', tag: 'Growth', tagColor: 'text-blue-600 bg-blue-50' },
              { label: '10,000+', rate: '$0.02', tag: 'Best Value', tagColor: 'text-green-700 bg-green-50' },
            ].map((tier) => (
              <div key={tier.label} className="px-5 py-4">
                <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded ${tier.tagColor} mb-2`}>
                  {tier.tag}
                </span>
                <p className="text-xl font-bold text-gray-900">{tier.rate}</p>
                <p className="text-xs text-gray-400 mt-0.5">per message</p>
                <p className="text-xs text-gray-500 mt-1.5 font-medium">{tier.label} messages</p>
              </div>
            ))}
          </div>
        </div>

        {/* Saved Cards */}
        {savedCards.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Payment Methods</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {savedCards.map((card) => (
                <div key={card.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <i className={`fab fa-cc-${card.brand.toLowerCase()} text-2xl text-gray-600`}></i>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        <span className="capitalize">{card.brand}</span> •••• {card.last4}
                        {card.is_default && (
                          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-green-50 text-green-700 rounded">Default</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">Expires {card.exp_month}/{card.exp_year}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveCard(card.id, { brand: card.brand, last4: card.last4 })}
                    className="px-2.5 py-1.5 text-xs text-red-600 border border-red-100 rounded hover:bg-red-50 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transaction History */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Transaction History</h3>
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              <i className="fas fa-spinner fa-spin mr-2"></i>Loading…
            </div>
          ) : transactions.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-500">No transactions yet</p>
              <p className="text-xs text-gray-400 mt-1">Your transaction history will appear here</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Transaction</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentTransactions.map((transaction) => {
                      const badge = getTransactionBadge(transaction.type)
                      return (
                        <tr key={transaction.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-7 h-7 ${badge.bg} rounded-md flex items-center justify-center flex-shrink-0`}>
                                <i className={`fas ${badge.icon} ${badge.color} text-xs`}></i>
                              </div>
                              <div>
                                <p className="text-sm text-gray-900">{transaction.description}</p>
                                <p className="text-xs text-gray-400">#{transaction.id.slice(0, 8)}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(transaction.created_at)}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              transaction.status === 'completed' ? 'bg-green-50 text-green-700'
                              : transaction.status === 'pending' ? 'bg-yellow-50 text-yellow-700'
                              : 'bg-red-50 text-red-700'
                            }`}>
                              {transaction.status ? transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1) : 'Unknown'}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={`text-sm font-medium ${
                              transaction.type === 'topup' || transaction.type === 'refund' ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {transaction.type === 'topup' || transaction.type === 'refund' ? '+' : '−'}
                              {Math.abs(transaction.amount).toLocaleString()} credits
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
                  <p className="text-xs text-gray-500">
                    {startIndex + 1}–{Math.min(startIndex + itemsPerPage, transactions.length)} of {transactions.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-left"></i>
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                          currentPage === page
                            ? 'bg-[#C54A3F] text-white border-[#C54A3F]'
                            : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50"
                    >
                      <i className="fas fa-angle-right"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {showTopUpModal && (
        <TopUpModal
          onClose={() => setShowTopUpModal(false)}
          savedCards={savedCards}
          user={user}
          onSuccess={() => {
            setShowTopUpModal(false)
            if (user?.userId) {
              fetchWalletData(user.userId, user.workspaceId)
              fetchTransactions(user.userId, user.workspaceId)
            }
          }}
          onError={(error) => setErrorModal(error)}
        />
      )}

      {showAddCardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Add Payment Method</h3>
              <button onClick={() => setShowAddCardModal(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
            <div className="px-5 py-4">
              <StripeCardForm
                onClose={() => setShowAddCardModal(false)}
                user={user}
                onSuccess={() => {
                  setShowAddCardModal(false)
                  if (user?.userId) fetchSavedCards(user.userId)
                }}
                onError={(error) => setErrorModal(error)}
              />
            </div>
          </div>
        </div>
      )}

      {errorModal && (
        <ErrorModal title={errorModal.title} message={errorModal.message} onClose={() => setErrorModal(null)} />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={confirmModal.onCancel}
        />
      )}
    </div>
  )
}

function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">{message}</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">OK</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600">{message}</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">Remove</button>
        </div>
      </div>
    </div>
  )
}

function TopUpModal({ onClose, savedCards, user, onSuccess, onError }) {
  const [credits, setCredits] = useState('')
  const [selectedCard, setSelectedCard] = useState(savedCards[0]?.id || '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const creditAmount = parseInt(credits) || 0
    const dollarAmount = parseFloat(calculateCreditCost(creditAmount))

    if (!credits || creditAmount < 10) {
      onError({ title: 'Invalid Amount', message: 'Minimum purchase is 10 credits ($0.30)' })
      return
    }

    setLoading(true)
    try {
      const topupHeaders = { 'Content-Type': 'application/json', 'x-user-id': user?.userId || '' }
      if (user?.workspaceId) topupHeaders['x-workspace-id'] = user.workspaceId
      const response = await fetch('/api/wallet/topup', {
        method: 'POST',
        headers: topupHeaders,
        body: JSON.stringify({ credits: creditAmount, amount: dollarAmount, payment_method_id: selectedCard }),
      })
      const data = await response.json()
      if (data.success) {
        onSuccess()
      } else {
        onError({ title: 'Purchase Failed', message: data.error || 'An error occurred.' })
      }
    } catch {
      onError({ title: 'Error', message: 'An unexpected error occurred. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Buy Credits</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Number of Credits *</label>
            <input
              type="number" required min="10" step="1"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
              placeholder="e.g. 1000"
            />
            <p className="text-xs text-gray-400 mt-1">Minimum: 10 credits ($0.30)</p>
          </div>

          {credits && parseInt(credits) >= 10 && (
            <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Total cost</span>
                <span className="font-semibold text-gray-900">${calculateCreditCost(credits)} USD</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400 mt-0.5">
                <span>Rate: ${getCreditRate(parseInt(credits))} per credit</span>
                <span>{parseInt(credits).toLocaleString()} credits</span>
              </div>
            </div>
          )}

          <div className="border border-gray-100 rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500">Pricing tiers</p>
            </div>
            {CREDIT_PRICING_TIERS.slice().reverse().map((tier, idx) => (
              <div key={idx} className="px-3 py-1.5 flex items-center justify-between border-b border-gray-100 last:border-0">
                <span className="text-xs text-gray-600">{tier.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-900">${tier.rate}/credit</span>
                  <span className="text-[10px] text-gray-400">{tier.description}</span>
                </div>
              </div>
            ))}
          </div>

          {savedCards.length > 0 ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Payment Method</label>
              <select
                value={selectedCard}
                onChange={(e) => setSelectedCard(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
                required
              >
                {savedCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.brand} •••• {card.last4} — Exp {card.exp_month}/{card.exp_year}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2.5">
              <p className="text-xs text-yellow-800">
                <i className="fas fa-exclamation-triangle mr-1.5"></i>
                Please add a payment method first.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
            <button
              type="submit"
              disabled={loading || savedCards.length === 0}
              className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50"
            >
              {loading
                ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Processing…</>
                : `Buy ${credits ? parseInt(credits).toLocaleString() : '0'} Credits`
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
