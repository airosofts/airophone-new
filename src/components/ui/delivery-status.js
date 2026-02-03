// src/components/ui/delivery-status.js
'use client'

import { useState, useEffect } from 'react'

export default function DeliveryStatus({ message, onStatusUpdate }) {
  const [status, setStatus] = useState(message.status || 'sending')
  const [deliveryDetails, setDeliveryDetails] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    setStatus(message.status || 'sending')
    if (message.delivery_details) {
      setDeliveryDetails(JSON.parse(message.delivery_details))
    }
  }, [message])

  const getStatusIcon = (currentStatus) => {
    switch (currentStatus) {
      case 'sending':
      case 'queued':
        return (
          <div className="flex items-center">
            <svg className="h-3 w-3 text-gray-400 animate-spin mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-xs text-gray-500">Sending...</span>
          </div>
        )
      case 'sent':
        return (
          <div className="flex items-center cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <svg className="h-3 w-3 text-gray-400 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs text-gray-500">Sent</span>
          </div>
        )
      case 'delivered':
        return (
          <div className="flex items-center cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <svg className="h-3 w-3 text-green-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-green-600">Delivered</span>
          </div>
        )
      case 'failed':
        return (
          <div className="flex items-center cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <svg className="h-3 w-3 text-red-500 mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-red-600">Failed</span>
          </div>
        )
      case 'read':
        return (
          <div className="flex items-center cursor-pointer" onClick={() => setShowDetails(!showDetails)}>
            <svg className="h-3 w-3 text-blue-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-blue-600">Read</span>
          </div>
        )
      default:
        return (
          <div className="flex items-center">
            <svg className="h-3 w-3 text-gray-400 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            <span className="text-xs text-gray-500">Unknown</span>
          </div>
        )
    }
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A'
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {formatTimestamp(message.created_at)}
        </span>
        {getStatusIcon(status)}
      </div>

      {/* Delivery Details Modal */}
      {showDetails && deliveryDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowDetails(false)}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Delivery Report</h3>
              <button onClick={() => setShowDetails(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Message ID:</span>
                  <p className="font-mono text-xs break-all">{message.telnyx_message_id}</p>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>
                  <p className={`font-medium ${
                    status === 'delivered' ? 'text-green-600' :
                    status === 'failed' ? 'text-red-600' :
                    status === 'sent' ? 'text-blue-600' : 'text-gray-600'
                  }`}>{status.charAt(0).toUpperCase() + status.slice(1)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Sent:</span>
                  <p>{formatTimestamp(message.created_at)}</p>
                </div>
                {message.delivered_at && (
                  <div>
                    <span className="text-gray-500">Delivered:</span>
                    <p>{formatTimestamp(message.delivered_at)}</p>
                  </div>
                )}
                <div>
                  <span className="text-gray-500">From:</span>
                  <p>{message.from_number}</p>
                </div>
                <div>
                  <span className="text-gray-500">To:</span>
                  <p>{message.to_number}</p>
                </div>
              </div>

              {deliveryDetails.error_code && (
                <div className="mt-4 p-3 bg-red-50 rounded-lg">
                  <p className="text-sm text-red-800">
                    <strong>Error:</strong> {deliveryDetails.error_code}
                  </p>
                  {deliveryDetails.error_message && (
                    <p className="text-xs text-red-600 mt-1">{deliveryDetails.error_message}</p>
                  )}
                </div>
              )}

              {deliveryDetails.carrier_info && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-700">
                    <strong>Carrier:</strong> {deliveryDetails.carrier_info.name || 'Unknown'}
                  </p>
                  {deliveryDetails.carrier_info.type && (
                    <p className="text-xs text-gray-600">Type: {deliveryDetails.carrier_info.type}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}