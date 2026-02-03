// src/components/ui/call-modal.js
'use client'

import { useState, useEffect } from 'react'

export default function CallModal({ call, onAccept, onReject, onEnd }) {
  const [showKeypad, setShowKeypad] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isOnHold, setIsOnHold] = useState(false)

  if (!call) return null

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    
    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const getCallStatusText = (status) => {
    switch (status) {
      case 'incoming': return 'Incoming call'
      case 'connecting': return 'Connecting...'
      case 'ringing': return 'Ringing...'
      case 'active': return 'Connected'
      case 'held': return 'On hold'
      case 'ended': return 'Call ended'
      default: return status
    }
  }

  const handleKeypadDigit = (digit) => {
    // This would be implemented in the parent component
    console.log('Keypad digit:', digit)
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
    // Call the actual mute function
    if (call.toggleMute) call.toggleMute()
  }

  const toggleHold = () => {
    setIsOnHold(!isOnHold)
    // Call the actual hold function
    if (call.toggleHold) call.toggleHold()
  }

  const isIncoming = call.status === 'incoming'
  const isActive = call.status === 'active'
  const phoneNumber = call.params?.caller_id_number || call.destination_number || call.phone_number

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Call Header */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 px-6 py-8 text-center text-white">
          <div className="mb-4">
            <div className="w-20 h-20 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold">
              {formatPhoneNumber(phoneNumber)}
            </h2>
            <p className="text-blue-100 mt-1">
              {getCallStatusText(call.status)}
            </p>
            {call.duration && (
              <p className="text-blue-100 text-sm mt-1">
                {call.duration}
              </p>
            )}
          </div>

          {/* Status indicator */}
          <div className="flex justify-center">
            {call.status === 'ringing' && (
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              </div>
            )}
          </div>
        </div>

        {/* Call Controls */}
        <div className="p-6">
          {isIncoming ? (
            /* Incoming call controls */
            <div className="flex justify-center space-x-8">
              <button
                onClick={onReject}
                className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 3l18 18" />
                </svg>
              </button>
              <button
                onClick={onAccept}
                className="w-16 h-16 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </button>
            </div>
          ) : (
            /* Active call controls */
            <div className="space-y-6">
              {/* Primary controls */}
              <div className="flex justify-center space-x-4">
                <button
                  onClick={toggleMute}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    isMuted ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {isMuted ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                </button>

                <button
                  onClick={() => setShowKeypad(!showKeypad)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    showKeypad ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM7 3H5v12a2 2 0 002 2 2 2 0 002-2V3zM17 9V7a2 2 0 012-2 2 2 0 012 2v10a2 2 0 01-2 2 2 2 0 01-2-2V9zM17 3h2v6h-2V3z" />
                  </svg>
                </button>

                <button
                  onClick={toggleHold}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    isOnHold ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>

              {/* Keypad */}
              {showKeypad && (
                <div className="grid grid-cols-3 gap-3 px-4">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                    <button
                      key={digit}
                      onClick={() => handleKeypadDigit(digit)}
                      className="aspect-square bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center text-xl font-semibold text-gray-700 transition-colors"
                    >
                      {digit}
                    </button>
                  ))}
                </div>
              )}

              {/* End call button */}
              <div className="flex justify-center">
                <button
                  onClick={onEnd}
                  className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg"
                >
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 3l18 18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}