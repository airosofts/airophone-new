// components/calling/PhoneNumberSelector.js
'use client'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPhone, faCheck } from '@fortawesome/free-solid-svg-icons'

export function PhoneNumberSelector({ 
  availableNumbers, 
  selectedNumber, 
  onNumberSelect, 
  isCallActive = false,
  formatPhoneNumber 
}) {
  if (!availableNumbers || availableNumbers.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        No phone numbers available
      </div>
    )
  }

  if (availableNumbers.length === 1) {
    return (
      <div className="flex items-center space-x-2 p-2 bg-gray-50 rounded-lg">
        <FontAwesomeIcon icon={faPhone} className="w-4 h-4 text-green-600" />
        <span className="text-sm font-medium text-gray-900">
          {formatPhoneNumber ? formatPhoneNumber(availableNumbers[0].phoneNumber) : availableNumbers[0].phoneNumber}
        </span>
        <span className="text-xs text-gray-500">
          ({availableNumbers[0].capabilities?.join(', ') || 'Voice'})
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-700">
        Select calling number:
      </label>
      <div className="space-y-1">
        {availableNumbers.map((number) => (
          <button
            key={number.phoneNumber}
            onClick={() => !isCallActive && onNumberSelect(number.phoneNumber)}
            disabled={isCallActive}
            className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-all ${
              selectedNumber === number.phoneNumber
                ? 'bg-green-50 border-2 border-green-200 text-green-900'
                : isCallActive
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700'
            }`}
          >
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon 
                icon={faPhone} 
                className={`w-3 h-3 ${
                  selectedNumber === number.phoneNumber ? 'text-green-600' : 'text-gray-500'
                }`} 
              />
              <span className="font-medium">
                {formatPhoneNumber ? formatPhoneNumber(number.phoneNumber) : number.phoneNumber}
              </span>
              <span className="text-xs text-gray-500">
                ({number.capabilities?.join(', ') || 'Voice'})
              </span>
            </div>
            
            {selectedNumber === number.phoneNumber && (
              <FontAwesomeIcon icon={faCheck} className="w-4 h-4 text-green-600" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}