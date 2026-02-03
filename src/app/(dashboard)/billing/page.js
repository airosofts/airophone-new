'use client'

import { useState, useEffect, useCallback } from 'react'
import { getCurrentUser } from '@/lib/auth'
import StripeCardForm from '@/components/billing/StripeCardForm'

// Tiered Credit Pricing
const CREDIT_PRICING_TIERS = [
  { min: 10001, max: Infinity, rate: 0.02, label: '10,000+ credits', description: 'Best value' },
  { min: 5001, max: 10000, rate: 0.025, label: '5,001-10,000 credits', description: 'Popular choice' },
  { min: 10, max: 5000, rate: 0.03, label: '10-5,000 credits', description: 'Starter rate' }
]

// Get the price rate for a given number of credits
const getCreditRate = (creditAmount) => {
  const amount = parseInt(creditAmount) || 0
  for (const tier of CREDIT_PRICING_TIERS) {
    if (amount >= tier.min && amount <= tier.max) {
      return tier.rate
    }
  }
  return CREDIT_PRICING_TIERS[CREDIT_PRICING_TIERS.length - 1].rate // Default to starter rate
}

// Calculate total cost based on tiered pricing
const calculateCreditCost = (creditAmount) => {
  const amount = parseInt(creditAmount) || 0
  const rate = getCreditRate(amount)
  return (amount * rate).toFixed(2)
}

// Legacy: Conversion rate for display purposes (wallet balance)
const CREDITS_PER_DOLLAR = 100

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

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Convert dollars to credits
  const dollarsToCreds = (dollars) => Math.floor(dollars * CREDITS_PER_DOLLAR)
  const credsToDollars = (credits) => (credits / CREDITS_PER_DOLLAR).toFixed(2)

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    if (currentUser && currentUser.userId) {
      fetchWalletData(currentUser.userId)
      fetchTransactions(currentUser.userId)
      fetchSavedCards(currentUser.userId)
    }
  }, [])

  const fetchWalletData = async (userId) => {
    try {
      setLoading(true)
      const response = await fetch('/api/wallet', {
        headers: {
          'x-user-id': userId
        }
      })
      const data = await response.json()
      if (data.success) {
        setWalletBalance(data.balance)
      }
    } catch (error) {
      console.error('Error fetching wallet data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTransactions = async (userId) => {
    try {
      const response = await fetch('/api/transactions', {
        headers: {
          'x-user-id': userId
        }
      })
      const data = await response.json()
      if (data.success) {
        setTransactions(data.transactions)
      }
    } catch (error) {
      console.error('Error fetching transactions:', error)
    }
  }

  const fetchSavedCards = async (userId) => {
    try {
      const response = await fetch('/api/payment-methods', {
        headers: {
          'x-user-id': userId
        }
      })
      const data = await response.json()
      if (data.success) {
        setSavedCards(data.cards)
      }
    } catch (error) {
      console.error('Error fetching saved cards:', error)
    }
  }

  const handleRemoveCard = (cardId, cardDetails) => {
    setConfirmModal({
      title: 'Remove Payment Method',
      message: `Are you sure you want to remove ${cardDetails.brand} •••• ${cardDetails.last4}?`,
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          const response = await fetch(`/api/payment-methods?id=${cardId}`, {
            method: 'DELETE',
            headers: {
              'x-user-id': user?.userId || ''
            }
          })

          const data = await response.json()

          if (data.success) {
            // Refresh the cards list
            if (user?.userId) {
              fetchSavedCards(user.userId)
            }
          } else {
            setErrorModal({
              title: 'Failed to Remove Card',
              message: data.error || 'An error occurred while removing the card.'
            })
          }
        } catch (error) {
          console.error('Error removing card:', error)
          setErrorModal({
            title: 'Error',
            message: 'An unexpected error occurred. Please try again.'
          })
        }
      },
      onCancel: () => setConfirmModal(null)
    })
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const getTransactionIcon = (type) => {
    switch (type) {
      case 'topup':
        return { icon: 'fa-plus-circle', color: 'text-green-600', bg: 'bg-green-50' }
      case 'deduction':
        return { icon: 'fa-minus-circle', color: 'text-red-600', bg: 'bg-red-50' }
      case 'refund':
        return { icon: 'fa-undo', color: 'text-blue-600', bg: 'bg-blue-50' }
      default:
        return { icon: 'fa-circle', color: 'text-gray-600', bg: 'bg-gray-50' }
    }
  }

  // Pagination
  const totalPages = Math.ceil(transactions.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentTransactions = transactions.slice(startIndex, endIndex)

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Credits & Payments</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your credits, payment methods, and transaction history
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Wallet Balance Card */}
          <div className="bg-gradient-to-br from-[#C54A3F] via-[#B73E34] to-[#A53329] rounded-xl shadow-lg p-8 text-white">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-white/80 mb-2">
                  <i className="fas fa-coins mr-2"></i>
                  Available Credits
                </p>
                {loading ? (
                  <div className="mb-6">
                    <div className="flex items-center space-x-2">
                      <div className="h-12 w-12 bg-white/20 rounded-lg animate-pulse"></div>
                      <div className="h-12 w-32 bg-white/20 rounded-lg animate-pulse"></div>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-5xl font-bold mb-2">{walletBalance.toLocaleString()}</h2>
                    <p className="text-sm text-white/70 mb-4">
                      <i className="fas fa-coins mr-1"></i>
                      Available Credits
                    </p>
                  </>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowTopUpModal(true)}
                    className="px-6 py-3 bg-white text-[#C54A3F] rounded-lg font-semibold hover:bg-gray-50 transition-all shadow-md hover:shadow-lg"
                  >
                    <i className="fas fa-plus mr-2"></i>
                    Buy Credits
                  </button>
                  <button
                    onClick={() => setShowAddCardModal(true)}
                    className="px-6 py-3 bg-white/10 backdrop-blur-sm text-white rounded-lg font-semibold hover:bg-white/20 transition-all border border-white/30"
                  >
                    <i className="fas fa-credit-card mr-2"></i>
                    Add Card
                  </button>
                </div>
              </div>
              <div className="hidden md:block">
                <div className="w-32 h-32 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm">
                  <i className="fas fa-coins text-6xl text-white/90"></i>
                </div>
              </div>
            </div>
          </div>

          {/* Message Pricing Tiers */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-gray-900 flex items-center">
                <i className="fas fa-chart-line mr-3 text-[#C54A3F]"></i>
                Message Pricing Tiers
              </h3>
              <p className="text-sm text-gray-600 mt-2 ml-9">
                Cost per SMS/MMS message sent
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Tier 1: 0-5,000 */}
              <div className="border-2 border-gray-200 rounded-xl p-5 hover:border-[#C54A3F] transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
                    STARTER
                  </span>
                </div>
                <div className="mb-4">
                  <p className="text-3xl font-bold text-gray-900 mb-1">$0.03</p>
                  <p className="text-sm text-gray-500">per message</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700">0 - 5,000 messages</p>
                  <div className="flex items-center text-xs text-gray-600">
                    <i className="fas fa-check text-green-600 mr-2"></i>
                    <span>Standard rate</span>
                  </div>
                  <div className="flex items-center text-xs text-gray-600">
                    <i className="fas fa-check text-green-600 mr-2"></i>
                    <span>All features included</span>
                  </div>
                </div>
              </div>

              {/* Tier 2: 5,001-10,000 */}
              <div className="border-2 border-gray-200 rounded-xl p-5 hover:border-[#C54A3F] transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
                    GROWTH
                  </span>
                </div>
                <div className="mb-4">
                  <p className="text-3xl font-bold text-gray-900 mb-1">$0.025</p>
                  <p className="text-sm text-gray-500">per message</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700">5,001 - 10,000 messages</p>
                  <div className="flex items-center text-xs text-gray-600">
                    <i className="fas fa-check text-green-600 mr-2"></i>
                    <span>17% savings</span>
                  </div>
                  <div className="flex items-center text-xs text-gray-600">
                    <i className="fas fa-check text-green-600 mr-2"></i>
                    <span>All features included</span>
                  </div>
                </div>
              </div>

              {/* Tier 3: 10,000+ */}
              <div className="border-2 border-gray-200 rounded-xl p-5 hover:border-[#C54A3F] transition-all">
                <div className="flex items-center justify-between mb-3">
                  <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                    BEST VALUE
                  </span>
                </div>
                <div className="mb-4">
                  <p className="text-3xl font-bold text-gray-900 mb-1">$0.02</p>
                  <p className="text-sm text-gray-500">per message</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700">10,000+ messages</p>
                  <div className="flex items-center text-xs text-gray-600">
                    <i className="fas fa-check text-green-600 mr-2"></i>
                    <span>33% savings</span>
                  </div>
                  <div className="flex items-center text-xs text-gray-600">
                    <i className="fas fa-check text-green-600 mr-2"></i>
                    <span>Volume discount</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <i className="fas fa-info-circle mr-2"></i>
                <strong>How it works:</strong> Your rate automatically decreases as you send more messages. Pricing is based on your total cumulative messages sent.
              </p>
            </div>
          </div>

          {/* Saved Cards */}
          {savedCards.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                <i className="fas fa-credit-card mr-3 text-[#C54A3F]"></i>
                Saved Payment Methods
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedCards.map((card) => (
                  <div key={card.id} className="border-2 border-gray-200 rounded-lg p-5 hover:border-[#C54A3F] transition-all hover:shadow-md group">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <i className={`fab fa-cc-${card.brand.toLowerCase()} text-3xl text-gray-700`}></i>
                        <span className="text-sm font-semibold text-gray-900 capitalize">{card.brand}</span>
                      </div>
                      {card.is_default && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-mono font-bold text-gray-900 mb-3">
                      •••• •••• •••• {card.last4}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 font-medium">Expires {card.exp_month}/{card.exp_year}</span>
                      <button
                        onClick={() => handleRemoveCard(card.id, { brand: card.brand, last4: card.last4 })}
                        className="text-red-600 hover:text-red-700 font-semibold transition-colors"
                      >
                        <i className="fas fa-trash mr-1"></i>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transaction History */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900 flex items-center">
                <i className="fas fa-history mr-3 text-[#C54A3F]"></i>
                Transaction History
              </h3>
            </div>

            {loading ? (
              <div className="p-12 text-center">
                <div className="inline-block">
                  <div className="relative w-12 h-12">
                    <div className="absolute inset-0 border-4 border-[#C54A3F]/20 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-[#C54A3F] border-t-transparent rounded-full animate-spin"></div>
                  </div>
                </div>
              </div>
            ) : transactions.length === 0 ? (
              <div className="p-12 text-center">
                <i className="fas fa-receipt text-gray-300 text-6xl mb-4"></i>
                <p className="text-gray-500 text-lg font-medium mb-2">No transactions yet</p>
                <p className="text-sm text-gray-400">Your transaction history will appear here</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Transaction
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {currentTransactions.map((transaction) => {
                        const config = getTransactionIcon(transaction.type)
                        return (
                          <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className={`w-10 h-10 ${config.bg} rounded-lg flex items-center justify-center mr-3`}>
                                  <i className={`fas ${config.icon} ${config.color}`}></i>
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{transaction.description}</div>
                                  <div className="text-xs text-gray-500">ID: {transaction.id.slice(0, 8)}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-gray-600">{formatDate(transaction.created_at)}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                transaction.status === 'completed'
                                  ? 'bg-green-100 text-green-800'
                                  : transaction.status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {transaction.status === 'completed' && <i className="fas fa-check-circle mr-1"></i>}
                                {transaction.status === 'pending' && <i className="fas fa-clock mr-1"></i>}
                                {transaction.status === 'failed' && <i className="fas fa-times-circle mr-1"></i>}
                                {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <span className={`text-sm font-bold ${
                                transaction.type === 'topup' || transaction.type === 'refund'
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }`}>
                                {transaction.type === 'topup' || transaction.type === 'refund' ? '+' : '-'}
                                ${Math.abs(transaction.amount).toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                    <div className="text-sm text-gray-600">
                      Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                      <span className="font-semibold">{Math.min(endIndex, transactions.length)}</span> of{' '}
                      <span className="font-semibold">{transactions.length}</span> transactions
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => goToPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <i className="fas fa-angle-left mr-1"></i>
                        Previous
                      </button>
                      <div className="flex items-center space-x-1">
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((page) => (
                          <button
                            key={page}
                            onClick={() => goToPage(page)}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                              currentPage === page
                                ? 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white shadow-md'
                                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => goToPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                        <i className="fas fa-angle-right ml-1"></i>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
              fetchWalletData(user.userId)
              fetchTransactions(user.userId)
            }
          }}
          onError={(error) => setErrorModal(error)}
        />
      )}

      {showAddCardModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">
                <i className="fas fa-credit-card mr-2 text-[#C54A3F]"></i>
                Add Payment Method
              </h3>
              <button
                onClick={() => setShowAddCardModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-6">
              <StripeCardForm
                onClose={() => setShowAddCardModal(false)}
                user={user}
                onSuccess={() => {
                  setShowAddCardModal(false)
                  if (user?.userId) {
                    fetchSavedCards(user.userId)
                  }
                }}
                onError={(error) => setErrorModal(error)}
              />
            </div>
          </div>
        </div>
      )}

      {errorModal && (
        <ErrorModal
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
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

// Error Modal
function ErrorModal({ title, message, onClose }) {
  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-[80] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-circle text-red-600 text-2xl"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">{title}</h3>
          <p className="text-sm text-gray-600 text-center mb-6">{message}</p>
          <button
            onClick={onClose}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-colors shadow-md"
          >
            <i className="fas fa-check mr-2"></i>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// Confirm Modal
function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-[80] p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slideUp">
        <div className="p-6">
          <div className="flex items-center justify-center w-14 h-14 bg-yellow-100 rounded-full mx-auto mb-4">
            <i className="fas fa-exclamation-triangle text-yellow-600 text-2xl"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-900 text-center mb-2">{title}</h3>
          <p className="text-sm text-gray-600 text-center mb-6">{message}</p>
          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              <i className="fas fa-times mr-2"></i>
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 rounded-xl transition-colors shadow-md"
            >
              <i className="fas fa-trash mr-2"></i>
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Top Up Modal
function TopUpModal({ onClose, savedCards, user, onSuccess, onError }) {
  const [credits, setCredits] = useState('')
  const [selectedCard, setSelectedCard] = useState(savedCards[0]?.id || '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const creditAmount = parseInt(credits) || 0
    const dollarAmount = parseFloat(calculateCreditCost(creditAmount))

    if (!credits || creditAmount < 10) {
      onError({
        title: 'Invalid Amount',
        message: 'Minimum purchase is 10 credits ($0.30)'
      })
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/wallet/topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.userId || ''
        },
        body: JSON.stringify({
          credits: creditAmount,
          amount: dollarAmount,
          payment_method_id: selectedCard
        })
      })

      const data = await response.json()

      if (data.success) {
        onSuccess()
      } else {
        onError({
          title: 'Purchase Failed',
          message: data.error || 'An error occurred while processing your payment.'
        })
      }
    } catch (error) {
      console.error('Error purchasing credits:', error)
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm bg-white/30 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-slideUp">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">
            <i className="fas fa-coins mr-2 text-[#C54A3F]"></i>
            Buy Credits
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              <i className="fas fa-coins mr-2"></i>
              Number of Credits to Purchase
            </label>
            <div className="relative">
              <input
                type="number"
                required
                min="10"
                step="1"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#C54A3F] focus:border-transparent"
                placeholder="0"
              />
            </div>
            {credits && parseInt(credits) >= 10 && (
              <div className="mt-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-lg font-bold text-blue-900">
                    <i className="fas fa-dollar-sign mr-1"></i>
                    Total Cost: ${calculateCreditCost(credits)} USD
                  </p>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <p className="text-blue-700">
                    <i className="fas fa-tag mr-1"></i>
                    Rate: ${getCreditRate(parseInt(credits))} per credit
                  </p>
                  <p className="text-blue-700 font-semibold">
                    {parseInt(credits).toLocaleString()} credits
                  </p>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              <i className="fas fa-info-circle mr-1"></i>
              Minimum purchase: 10 credits ($0.30)
            </p>
          </div>

          {/* Pricing Tiers Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <h4 className="text-sm font-bold text-gray-900 mb-3">
              <i className="fas fa-chart-line mr-2 text-[#C54A3F]"></i>
              Credit Pricing Tiers
            </h4>
            <div className="space-y-2">
              {CREDIT_PRICING_TIERS.slice().reverse().map((tier, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700">{tier.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">${tier.rate}/credit</span>
                    <span className="px-2 py-1 bg-gray-200 text-gray-600 rounded-full text-[10px] font-semibold">
                      {tier.description}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Method */}
          {savedCards.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                <i className="fas fa-credit-card mr-2"></i>
                Payment Method
              </label>
              <select
                value={selectedCard}
                onChange={(e) => setSelectedCard(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#C54A3F] focus:border-transparent"
                required
              >
                {savedCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.brand} •••• {card.last4} - Exp {card.exp_month}/{card.exp_year}
                  </option>
                ))}
              </select>
            </div>
          )}

          {savedCards.length === 0 && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4">
              <p className="text-sm text-yellow-800">
                <i className="fas fa-exclamation-triangle mr-2"></i>
                Please add a payment method first to purchase credits.
              </p>
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || savedCards.length === 0}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-all shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Processing...
                </>
              ) : (
                <>
                  <i className="fas fa-check-circle mr-2"></i>
                  Buy {credits ? parseInt(credits).toLocaleString() : '0'} Credits
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

