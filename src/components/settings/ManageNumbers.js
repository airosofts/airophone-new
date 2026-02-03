'use client'

import { useState, useEffect } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost } from '@/lib/api-client'

export default function ManageNumbers() {
  const [loading, setLoading] = useState(false)
  const [availableNumbers, setAvailableNumbers] = useState([])
  const [myNumbers, setMyNumbers] = useState([])
  const [wallet, setWallet] = useState(null)
  const [user, setUser] = useState(null)
  const [purchasing, setPurchasing] = useState(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(null)
  const [filters, setFilters] = useState({
    country_code: 'US',
    locality: '',
    administrative_area: '',
    national_destination_code: '',
    number_type: '',
    features: [],
  })
  const [searchPerformed, setSearchPerformed] = useState(false)
  const [loadingWallet, setLoadingWallet] = useState(true)
  const [loadingMyNumbers, setLoadingMyNumbers] = useState(true)
  const [confirmPurchase, setConfirmPurchase] = useState(null)
  const [editingNumberId, setEditingNumberId] = useState(null)
  const [editingNumberName, setEditingNumberName] = useState('')

  useEffect(() => {
    const init = async () => {
      const currentUser = getCurrentUser()
      console.log('Current user:', currentUser)
      setUser(currentUser)

      // Wait a bit for session to be ready
      await new Promise(resolve => setTimeout(resolve, 100))

      await fetchWallet()
      await fetchMyNumbers()
    }

    init()
  }, [])

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
        setMyNumbers(data.phoneNumbers || [])
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
      Object.keys(filters).forEach(key => {
        if (filters[key]) {
          if (key === 'features' && filters[key].length > 0) {
            filters[key].forEach(feature => queryParams.append(key, feature))
          } else if (key !== 'features') {
            queryParams.append(key, filters[key])
          }
        }
      })

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
    // Calculate total cost: $1 one-time + $1 monthly + $0.30 VAT = $2.30
    const oneTimeCost = 1.00
    const monthlyCost = 1.00
    const vat = 0.30
    const totalCost = oneTimeCost + monthlyCost + vat

    // Check wallet balance
    if (!wallet || wallet.balance < totalCost) {
      setShowError({
        title: 'Insufficient Balance',
        message: `You need $${totalCost.toFixed(2)} to purchase this number. Your balance: $${(wallet?.balance || 0).toFixed(2)}`,
        action: 'topup'
      })
      return
    }

    // Show confirmation dialog
    setConfirmPurchase({
      number: number,
      oneTimeCost,
      monthlyCost,
      vat,
      totalCost
    })
  }

  const confirmPurchaseAction = async () => {
    const { number, oneTimeCost, monthlyCost, totalCost } = confirmPurchase

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
          'x-messaging-profile-id': user.messagingProfileId || ''
        },
        body: JSON.stringify({
          phoneNumber: number.phone_number,
          upfrontCost: oneTimeCost.toFixed(2),
          monthlyCost: monthlyCost.toFixed(2),
          vat: 0.30,
          totalCost: totalCost.toFixed(2)
        })
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
        setShowError({
          title: 'Purchase Failed',
          message: data.error || data.message || 'Failed to purchase number',
          details: data.details
        })
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
  }

  const cancelEditingNumber = () => {
    setEditingNumberId(null)
    setEditingNumberName('')
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
          customName: editingNumberName.trim() || null
        })
      })

      const data = await response.json()

      if (data.success) {
        // Update local state
        setMyNumbers(prev => prev.map(num =>
          num.id === numberId
            ? { ...num, custom_name: editingNumberName.trim() || null }
            : num
        ))
        setEditingNumberId(null)
        setEditingNumberName('')
      } else {
        setShowError({
          title: 'Update Failed',
          message: data.error || 'Failed to update custom name'
        })
      }
    } catch (error) {
      console.error('Error saving custom name:', error)
      setShowError({
        title: 'Update Error',
        message: error.message || 'An error occurred while updating the custom name'
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Success Toast */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
          <div className="bg-green-500 text-white px-6 py-4 rounded-lg shadow-2xl flex items-center space-x-3">
            <i className="fas fa-check-circle text-2xl"></i>
            <div>
              <p className="font-bold">Number Purchased!</p>
              <p className="text-sm">Your new number is ready to use</p>
            </div>
            <button
              onClick={() => setShowSuccess(false)}
              className="ml-4 hover:bg-green-600 rounded-full p-1"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmPurchase && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start space-x-4 mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <i className="fas fa-shopping-cart text-blue-600 text-xl"></i>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Purchase</h3>
                <p className="text-gray-600">
                  You are about to purchase{' '}
                  <span className="font-mono font-bold text-gray-900">
                    {formatPhoneNumber(confirmPurchase.number.phone_number)}
                  </span>
                </p>
              </div>
            </div>

            {/* Cost Breakdown */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">One-time setup fee:</span>
                <span className="font-semibold text-gray-900">${confirmPurchase.oneTimeCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">First month charge:</span>
                <span className="font-semibold text-gray-900">${confirmPurchase.monthlyCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">VAT (13%):</span>
                <span className="font-semibold text-gray-900">${confirmPurchase.vat.toFixed(2)}</span>
              </div>
              <div className="border-t border-gray-300 pt-2 mt-2"></div>
              <div className="flex justify-between text-base">
                <span className="font-bold text-gray-900">Total charge:</span>
                <span className="font-bold text-[#C54A3F] text-lg">${confirmPurchase.totalCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-gray-600">New balance:</span>
                <span className="font-semibold text-gray-700">
                  ${(wallet.balance - confirmPurchase.totalCost).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Monthly Recurring Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
              <div className="flex items-start space-x-2">
                <i className="fas fa-info-circle text-amber-600 mt-0.5"></i>
                <p className="text-xs text-amber-800">
                  After purchase, you&apos;ll be charged <strong>${confirmPurchase.monthlyCost.toFixed(2)}/month</strong> for this number.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setConfirmPurchase(null)}
                className="px-5 py-2.5 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmPurchaseAction}
                className="px-5 py-2.5 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white rounded-lg font-semibold hover:from-[#B73E34] hover:to-[#A53329] transition-all shadow-md hover:shadow-lg"
              >
                Confirm Purchase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {showError && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 mb-2">{showError.title}</h3>
                <p className="text-gray-600 mb-4">{showError.message}</p>
                {showError.details && (
                  <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg font-mono">
                    {JSON.stringify(showError.details, null, 2)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              {showError.action === 'topup' && (
                <button
                  onClick={() => {
                    setShowError(null)
                    window.location.href = '/billing'
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white rounded-lg font-semibold hover:from-[#B73E34] hover:to-[#A53329]"
                >
                  Go to Billing
                </button>
              )}
              <button
                onClick={() => setShowError(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* My Phone Numbers */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <h3 className="text-xl font-bold text-gray-900 flex items-center">
            <i className="fas fa-phone-alt mr-3 text-[#C54A3F]"></i>
            My Phone Numbers
            {!loadingMyNumbers && (
              <span className="ml-3 px-3 py-1 bg-[#C54A3F]/10 text-[#C54A3F] text-sm font-semibold rounded-full">
                {myNumbers.length}
              </span>
            )}
          </h3>
        </div>
        {loadingMyNumbers ? (
          <div className="p-8">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center space-x-4 mb-4">
                <div className="w-12 h-12 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-6 bg-gray-200 rounded w-48 mb-2 animate-pulse"></div>
                  <div className="h-4 bg-gray-100 rounded w-32 animate-pulse"></div>
                </div>
              </div>
            ))}
          </div>
        ) : myNumbers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-phone-slash text-gray-300 text-3xl"></i>
            </div>
            <p className="text-gray-500 text-lg font-medium mb-2">No phone numbers yet</p>
            <p className="text-sm text-gray-400">Search and purchase numbers below</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {myNumbers.map((number, index) => {
              const isEditing = editingNumberId === number.id
              return (
                <div key={index} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <i className="fas fa-check-circle text-green-600 text-xl"></i>
                    </div>
                    <div className="flex-1">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editingNumberName}
                            onChange={(e) => setEditingNumberName(e.target.value)}
                            placeholder="Enter custom name (e.g., California Office)"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C54A3F]"
                            autoFocus
                          />
                          <p className="text-sm text-gray-600 font-mono">
                            {formatPhoneNumber(number.phoneNumber)}
                          </p>
                        </div>
                      ) : (
                        <>
                          {number.custom_name && (
                            <p className="text-lg font-bold text-gray-900">
                              {number.custom_name}
                            </p>
                          )}
                          <p className={`${number.custom_name ? 'text-sm' : 'text-lg'} font-${number.custom_name ? 'medium' : 'bold'} text-gray-${number.custom_name ? '600' : '900'} font-mono`}>
                            {formatPhoneNumber(number.phoneNumber)}
                          </p>
                        </>
                      )}
                      <div className="flex items-center space-x-3 mt-1">
                        <span className="text-xs text-gray-500">
                          <i className="fas fa-calendar mr-1"></i>
                          Purchased {new Date(number.purchasedAt || number.created_at).toLocaleDateString()}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          number.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {number.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveCustomName(number.id)}
                            className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-semibold"
                          >
                            <i className="fas fa-check mr-1"></i>
                            Save
                          </button>
                          <button
                            onClick={cancelEditingNumber}
                            className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-semibold"
                          >
                            <i className="fas fa-times mr-1"></i>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEditingNumber(number)}
                          className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-semibold"
                        >
                          <i className="fas fa-edit mr-1"></i>
                          {number.custom_name ? 'Edit Name' : 'Add Name'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Search Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
          <i className="fas fa-search mr-3 text-[#C54A3F]"></i>
          Search Available Numbers
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Country - Fixed to USA */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-globe mr-2"></i>
              Country
            </label>
            <div className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 font-medium">
              <i className="fas fa-flag-usa mr-2"></i>
              United States
            </div>
          </div>

          {/* Area Code / NPA */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-hashtag mr-2"></i>
              Area Code
            </label>
            <input
              type="text"
              value={filters.national_destination_code}
              onChange={(e) => handleFilterChange('national_destination_code', e.target.value.replace(/\D/g, ''))}
              placeholder="e.g., 212, 415"
              maxLength="3"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C54A3F] focus:border-transparent"
            />
          </div>

          {/* State / Administrative Area */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-map-marked-alt mr-2"></i>
              State
            </label>
            <select
              value={filters.administrative_area}
              onChange={(e) => handleFilterChange('administrative_area', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C54A3F] focus:border-transparent bg-white"
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

          {/* City / Locality */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <i className="fas fa-city mr-2"></i>
              City
            </label>
            <input
              type="text"
              value={filters.locality}
              onChange={(e) => handleFilterChange('locality', e.target.value)}
              placeholder="e.g., Miami, Dallas, Seattle"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C54A3F] focus:border-transparent"
            />
          </div>
        </div>

        {/* Search Button */}
        <button
          onClick={searchNumbers}
          disabled={loading}
          className="w-full px-6 py-3.5 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white rounded-lg font-bold text-lg hover:from-[#B73E34] hover:to-[#A53329] transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {loading ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              Searching...
            </>
          ) : (
            <>
              <i className="fas fa-search mr-2"></i>
              Search Available Numbers
            </>
          )}
        </button>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
            <h3 className="text-xl font-bold text-gray-900 flex items-center">
              <i className="fas fa-list mr-3 text-[#C54A3F]"></i>
              Available Numbers
              {!loading && (
                <span className="ml-3 px-3 py-1 bg-blue-100 text-blue-700 text-sm font-semibold rounded-full">
                  {availableNumbers.length} found
                </span>
              )}
            </h3>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 border-4 border-[#C54A3F]/20 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-[#C54A3F] border-t-transparent rounded-full animate-spin"></div>
                </div>
              </div>
              <p className="text-gray-500 mt-4 font-medium">Searching for available numbers...</p>
            </div>
          ) : availableNumbers.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-phone-slash text-gray-300 text-3xl"></i>
              </div>
              <p className="text-gray-500 text-lg font-medium mb-2">No numbers found</p>
              <p className="text-sm text-gray-400">Try adjusting your search filters</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {availableNumbers.map((number, index) => {
                // Calculate total cost: $1 one-time + $1 monthly + $0.30 VAT = $2.30
                const oneTimeCost = 1.00
                const monthlyCost = 1.00
                const vat = 0.30
                const totalCost = oneTimeCost + monthlyCost + vat
                const isPurchasing = purchasing === number.phone_number
                const canAfford = wallet && wallet.balance >= totalCost

                return (
                  <div key={index} className="p-5 hover:bg-gray-50 transition-all border-l-4 border-transparent hover:border-[#C54A3F]">
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex-1">
                        <div className="flex items-start space-x-4">
                          <div className="w-14 h-14 bg-gradient-to-br from-[#C54A3F]/10 to-[#B73E34]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                            <i className="fas fa-phone-alt text-[#C54A3F] text-xl"></i>
                          </div>
                          <div className="flex-1">
                            <p className="text-xl font-bold text-gray-900 font-mono mb-2">
                              {formatPhoneNumber(number.phone_number)}
                            </p>
                            <div className="flex items-center flex-wrap gap-3 mb-3">
                              <span className="text-sm text-gray-600 font-medium">
                                <i className="fas fa-map-marker-alt mr-1.5 text-red-500"></i>
                                {number.locality}, {number.administrative_area}
                              </span>
                              <span className="text-sm text-gray-500">
                                <i className="fas fa-tag mr-1.5"></i>
                                {number.record_type}
                              </span>
                            </div>
                            <div className="flex items-center flex-wrap gap-2">
                              {number.features?.voice && (
                                <span className="px-3 py-1.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full">
                                  <i className="fas fa-phone mr-1"></i>
                                  Voice
                                </span>
                              )}
                              {number.features?.sms && (
                                <span className="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                                  <i className="fas fa-comment mr-1"></i>
                                  SMS
                                </span>
                              )}
                              {number.features?.mms && (
                                <span className="px-3 py-1.5 bg-purple-100 text-purple-700 text-xs font-bold rounded-full">
                                  <i className="fas fa-image mr-1"></i>
                                  MMS
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="mb-4">
                          <p className="text-3xl font-bold text-gray-900 mb-1">
                            ${totalCost.toFixed(2)}
                          </p>
                          <p className="text-xs text-gray-500 font-medium mb-0.5">
                            Setup: ${oneTimeCost.toFixed(2)} + Monthly: ${monthlyCost.toFixed(2)}
                          </p>
                          <p className="text-xs text-gray-400">
                            (includes ${vat.toFixed(2)} VAT)
                          </p>
                        </div>
                        <button
                          onClick={() => handlePurchase(number)}
                          disabled={isPurchasing || !canAfford}
                          className={`px-6 py-3 rounded-lg font-bold shadow-md transition-all transform hover:scale-105 active:scale-95 ${
                            isPurchasing
                              ? 'bg-gray-300 text-gray-600 cursor-wait'
                              : canAfford
                              ? 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34] text-white hover:from-[#B73E34] hover:to-[#A53329] hover:shadow-lg'
                              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          {isPurchasing ? (
                            <>
                              <i className="fas fa-spinner fa-spin mr-2"></i>
                              Purchasing...
                            </>
                          ) : canAfford ? (
                            <>
                              <i className="fas fa-shopping-cart mr-2"></i>
                              Buy Now
                            </>
                          ) : (
                            <>
                              <i className="fas fa-wallet mr-2"></i>
                              Insufficient Funds
                            </>
                          )}
                        </button>
                      </div>
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
