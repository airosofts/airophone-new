// src/components/ui/phone-number-selector-diagnostic.js
'use client'

import { useState, useEffect } from 'react'

export default function PhoneNumberSelectorDiagnostic({ selectedNumber, onNumberChange }) {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOpen, setIsOpen] = useState(false)
  const [debugInfo, setDebugInfo] = useState(null)

  useEffect(() => {
    fetchPhoneNumbers()
  }, [])

  const fetchPhoneNumbers = async () => {
    console.log('=== DIAGNOSTIC: Starting phone number fetch ===')
    console.log('Current URL:', window.location.href)
    console.log('Current time:', new Date().toISOString())
    
    try {
      setLoading(true)
      setError(null)

      console.log('Making API request to:', '/api/phone-numbers')
      
      const response = await fetch('/api/phone-numbers', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      })

      console.log('API Response received:')
      console.log('- Status:', response.status)
      console.log('- Status Text:', response.statusText)
      console.log('- Headers:', Object.fromEntries(response.headers.entries()))

      const responseText = await response.text()
      console.log('Raw response text:', responseText)

      let data
      try {
        data = JSON.parse(responseText)
        console.log('Parsed response data:', data)
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', parseError)
        setError(`Invalid JSON response: ${responseText.substring(0, 100)}...`)
        setDebugInfo({
          status: response.status,
          statusText: response.statusText,
          rawResponse: responseText.substring(0, 200)
        })
        return
      }

      if (!response.ok) {
        console.error('API request failed:', data)
        setError(`API Error (${response.status}): ${data.error || data.message || 'Unknown error'}`)
        setDebugInfo({
          status: response.status,
          statusText: response.statusText,
          errorDetails: data
        })
        return
      }

      if (data.success && data.phoneNumbers) {
        console.log(`Successfully received ${data.phoneNumbers.length} phone numbers:`)
        data.phoneNumbers.forEach((phone, index) => {
          console.log(`${index + 1}. ${phone.phoneNumber} (${phone.status})`)
        })

        setPhoneNumbers(data.phoneNumbers)
        setDebugInfo({
          status: response.status,
          success: true,
          count: data.phoneNumbers.length,
          source: data.source || 'unknown'
        })

        // Auto-select first number if none selected
        if (!selectedNumber && data.phoneNumbers.length > 0) {
          console.log('Auto-selecting first number:', data.phoneNumbers[0].phoneNumber)
          onNumberChange(data.phoneNumbers[0].phoneNumber)
        }
      } else {
        console.warn('API returned success but no phone numbers:', data)
        setError('No phone numbers available from API')
        setDebugInfo({
          status: response.status,
          success: data.success,
          response: data
        })
      }

    } catch (fetchError) {
      console.error('=== FETCH ERROR ===')
      console.error('Error message:', fetchError.message)
      console.error('Error stack:', fetchError.stack)
      
      setError(`Network error: ${fetchError.message}`)
      setDebugInfo({
        error: fetchError.message,
        type: 'network_error'
      })
    } finally {
      setLoading(false)
      console.log('=== DIAGNOSTIC: Phone number fetch completed ===')
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

  const getStatusColor = (status) => {
    switch (status) {
      case 'purchased': return 'bg-green-100 text-green-800'
      case 'active': return 'bg-green-100 text-green-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="relative">
        <div className="flex items-center p-3 bg-gray-100 rounded-lg">
          <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
          <span className="text-sm text-gray-600">Loading phone numbers...</span>
        </div>
        {debugInfo && (
          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
            <strong>Debug:</strong> {JSON.stringify(debugInfo)}
          </div>
        )}
      </div>
    )
  }

  if (error) {
    return (
      <div className="relative">
        <div className="flex items-center p-3 bg-red-50 border border-red-200 rounded-lg">
          <svg className="h-4 w-4 text-red-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <span className="text-sm text-red-700">{error}</span>
            <button 
              onClick={fetchPhoneNumbers}
              className="ml-2 text-xs text-red-600 hover:text-red-800 underline"
            >
              Retry
            </button>
          </div>
        </div>
        {debugInfo && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs font-mono">
            <strong>Debug Info:</strong>
            <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
          </div>
        )}
      </div>
    )
  }

  if (phoneNumbers.length === 0) {
    return (
      <div className="relative">
        <div className="flex items-center p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <svg className="h-4 w-4 text-yellow-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-sm text-yellow-700">No phone numbers found</span>
        </div>
        {debugInfo && (
          <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
            <strong>Debug:</strong> {JSON.stringify(debugInfo)}
          </div>
        )}
      </div>
    )
  }

  const selectedPhoneData = phoneNumbers.find(p => p.phoneNumber === selectedNumber)

  return (
    <div className="relative">
      {debugInfo && (
        <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
          <strong>Success:</strong> Loaded {phoneNumbers.length} numbers from {debugInfo.source || 'API'}
        </div>
      )}
      
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        <div className="flex items-center">
          <div className="flex items-center">
            <div className="h-2 w-2 bg-green-400 rounded-full mr-3"></div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {selectedPhoneData ? formatPhoneNumber(selectedPhoneData.phoneNumber) : 'Select a number'}
              </p>
              {selectedPhoneData && (
                <p className="text-xs text-gray-500">
                  {selectedPhoneData.status} • {selectedPhoneData.capabilities?.includes('sms') ? 'SMS' : ''} 
                  {selectedPhoneData.capabilities?.includes('voice') ? ' • Voice' : ''}
                </p>
              )}
            </div>
          </div>
        </div>
        <svg className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
          {phoneNumbers.map((phone) => (
            <button
              key={phone.id}
              type="button"
              onClick={() => {
                onNumberChange(phone.phoneNumber)
                setIsOpen(false)
              }}
              className={`w-full text-left p-3 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                selectedNumber === phone.phoneNumber ? 'bg-blue-50 border-l-4 border-blue-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className={`h-2 w-2 rounded-full mr-3 ${
                    phone.status === 'purchased' || phone.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'
                  }`}></div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {formatPhoneNumber(phone.phoneNumber)}
                    </p>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(phone.status)}`}>
                        {phone.status}
                      </span>
                      {phone.capabilities?.includes('sms') && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          SMS
                        </span>
                      )}
                      {phone.capabilities?.includes('voice') && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Voice
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {selectedNumber === phone.phoneNumber && (
                  <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        ></div>
      )}
    </div>
  )
}