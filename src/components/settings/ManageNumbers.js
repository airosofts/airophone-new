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
    exact_number: '',
  })
  const [searchPerformed, setSearchPerformed] = useState(false)
  const [loadingWallet, setLoadingWallet] = useState(true)
  const [loadingMyNumbers, setLoadingMyNumbers] = useState(true)
  const [confirmPurchase, setConfirmPurchase] = useState(null)
  const [editingNumberId, setEditingNumberId] = useState(null)
  const [editingNumberName, setEditingNumberName] = useState('')
  const [editingNumberPrefix, setEditingNumberPrefix] = useState('')

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
    setEditingNumberPrefix(number.prefix || '')
  }

  const cancelEditingNumber = () => {
    setEditingNumberId(null)
    setEditingNumberName('')
    setEditingNumberPrefix('')
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

  return (
    <div className="space-y-4">
      {/* Success Toast */}
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50">
          <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 text-sm">
            <i className="fas fa-check-circle text-green-400"></i>
            <span>Number purchased — ready to use</span>
            <button onClick={() => setShowSuccess(false)} className="ml-2 text-gray-400 hover:text-white">
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmPurchase && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Confirm Purchase</h3>
              <p className="text-sm text-gray-500 mt-0.5 font-mono">{formatPhoneNumber(confirmPurchase.number.phone_number)}</p>
            </div>
            <div className="px-5 py-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600"><span>Setup fee</span><span>${confirmPurchase.oneTimeCost.toFixed(2)}</span></div>
              <div className="flex justify-between text-gray-600"><span>First month</span><span>${confirmPurchase.monthlyCost.toFixed(2)}</span></div>
              <div className="flex justify-between text-gray-600"><span>VAT (13%)</span><span>${confirmPurchase.vat.toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold text-gray-900 pt-2 border-t border-gray-100">
                <span>Total</span><span>${confirmPurchase.totalCost.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-400 pt-1">${confirmPurchase.monthlyCost.toFixed(2)}/month recurring after purchase</p>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setConfirmPurchase(null)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
              <button onClick={confirmPurchaseAction} className="px-3 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md">Confirm Purchase</button>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {showError && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">{showError.title}</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600">{showError.message}</p>
              {showError.details && (
                <pre className="mt-3 text-xs text-gray-500 bg-gray-50 p-3 rounded font-mono overflow-auto">
                  {JSON.stringify(showError.details, null, 2)}
                </pre>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              {showError.action === 'topup' && (
                <button onClick={() => { setShowError(null); window.location.href = '/billing' }}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md">
                  Go to Billing
                </button>
              )}
              <button onClick={() => setShowError(null)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* My Phone Numbers */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Phone Numbers</h3>
          {!loadingMyNumbers && myNumbers.length > 0 && (
            <span className="text-xs text-gray-400">{myNumbers.length} active</span>
          )}
        </div>
        {loadingMyNumbers ? (
          <div className="px-5 py-4 space-y-3">
            {[1,2].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-2 h-2 bg-gray-200 rounded-full animate-pulse" />
                <div className="h-4 bg-gray-100 rounded w-40 animate-pulse" />
                <div className="h-3 bg-gray-100 rounded w-24 animate-pulse ml-auto" />
              </div>
            ))}
          </div>
        ) : myNumbers.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-gray-500">No phone numbers yet</p>
            <p className="text-xs text-gray-400 mt-1">Search and purchase a number below</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {myNumbers.map((number, index) => {
              const isEditing = editingNumberId === number.id
              return (
                <div key={index} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${number.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editingNumberName}
                          onChange={(e) => setEditingNumberName(e.target.value)}
                          placeholder="Custom name (e.g., California Office)"
                          className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editingNumberPrefix}
                          onChange={(e) => setEditingNumberPrefix(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="Prefix e.g. 217615"
                          maxLength={6}
                          className="w-36 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
                        />
                      </div>
                    ) : (
                      <div>
                        {number.custom_name && <p className="text-sm font-medium text-gray-900">{number.custom_name}</p>}
                        <p className={`font-mono text-sm ${number.custom_name ? 'text-gray-500' : 'text-gray-900 font-medium'}`}>
                          {formatPhoneNumber(number.phoneNumber)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Prefix column */}
                  {!isEditing && (
                    <div className="w-24 flex-shrink-0">
                      {number.prefix ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono font-medium">
                          {number.prefix}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${number.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {number.status}
                    </span>
                    {isEditing ? (
                      <div className="flex gap-1.5">
                        <button onClick={() => saveCustomName(number.id)} className="px-2.5 py-1 text-xs font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded">Save</button>
                        <button onClick={cancelEditingNumber} className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded hover:bg-gray-50">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startEditingNumber(number)} className="text-xs text-gray-400 hover:text-gray-700">
                        <i className="fas fa-pen mr-1"></i>Edit
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Search Filters */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Search Available Numbers</h3>
        </div>
        <div className="px-5 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Country</label>
            <div className="px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-sm text-gray-500">
              United States
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Area Code</label>
            <input
              type="text"
              value={filters.national_destination_code}
              onChange={(e) => handleFilterChange('national_destination_code', e.target.value.replace(/\D/g, ''))}
              placeholder="e.g., 212, 415"
              maxLength="3"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">State</label>
            <select
              value={filters.administrative_area}
              onChange={(e) => handleFilterChange('administrative_area', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F] bg-white"
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
            <label className="block text-xs font-medium text-gray-600 mb-1.5">City</label>
            <input
              type="text"
              value={filters.locality}
              onChange={(e) => handleFilterChange('locality', e.target.value)}
              placeholder="e.g., Miami, Dallas"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
            />
          </div>
        </div>

        {/* Exact number search */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400 whitespace-nowrap">or search exact number</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Number prefix or exact number</label>
          <input
            type="text"
            value={filters.exact_number}
            onChange={(e) => handleFilterChange('exact_number', e.target.value)}
            placeholder="e.g., 212555 or +12125551234"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#C54A3F] focus:border-[#C54A3F]"
          />
          {filters.exact_number && (
            <p className="text-xs text-gray-400 mt-1">
              <i className="fas fa-info-circle mr-1"></i>
              Enter first 6+ digits to browse a range, or full number to check availability
            </p>
          )}
        </div>

        <button
          onClick={searchNumbers}
          disabled={loading}
          className="px-4 py-2 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Searching…</> : <><i className="fas fa-search mr-1.5"></i>Search Numbers</>}
        </button>
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Available Numbers</h3>
            {!loading && <span className="text-xs text-gray-400">{availableNumbers.length} found</span>}
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              <i className="fas fa-spinner fa-spin mr-2"></i>Searching…
            </div>
          ) : availableNumbers.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-gray-500">No numbers found</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {availableNumbers.map((number, index) => {
                const oneTimeCost = 1.00
                const monthlyCost = 1.00
                const vat = 0.30
                const totalCost = oneTimeCost + monthlyCost + vat
                const isPurchasing = purchasing === number.phone_number
                const canAfford = wallet && wallet.balance >= totalCost

                return (
                  <div key={index} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 font-mono">{formatPhoneNumber(number.phone_number)}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500">{number.locality}, {number.administrative_area}</span>
                        <div className="flex gap-1">
                          {number.features?.voice && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">Voice</span>}
                          {number.features?.sms && <span className="px-1.5 py-0.5 bg-green-50 text-green-600 text-[10px] font-medium rounded">SMS</span>}
                          {number.features?.mms && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[10px] font-medium rounded">MMS</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">${totalCost.toFixed(2)}</p>
                        <p className="text-[10px] text-gray-400">setup + 1st month</p>
                      </div>
                      <button
                        onClick={() => handlePurchase(number)}
                        disabled={isPurchasing || !canAfford}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          isPurchasing ? 'bg-gray-100 text-gray-400 cursor-wait'
                          : canAfford ? 'bg-[#C54A3F] hover:bg-[#B73E34] text-white'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {isPurchasing ? <><i className="fas fa-spinner fa-spin mr-1"></i>Buying…</>
                          : canAfford ? 'Buy'
                          : 'No funds'}
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
