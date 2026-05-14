'use client'

import { createContext, useContext } from 'react'
import { useWebRTCCall } from '@/hooks/useWebRTCCall'
import CallInterface from '@/components/calling/CallInterface'

const CallContext = createContext(null)

function formatPhoneNumber(phone) {
  if (!phone) return phone
  const digits = phone.replace(/\D/g, '')
  const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
  if (withoutCountry.length === 10) {
    return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
  }
  return phone
}

export function CallProvider({ children }) {
  const callHook = useWebRTCCall()

  return (
    <CallContext.Provider value={callHook}>
      {children}
      {callHook && (
        // Render at the top of the stacking context so it floats above all modals
        <div style={{ position: 'relative', zIndex: 9000 }}>
          <CallInterface
            callStatus={callHook.callStatus}
            currentCall={callHook.currentCall}
            incomingCall={callHook.incomingCall}
            callDuration={callHook.callDuration}
            isCallActive={callHook.isCallActive}
            onAcceptCall={callHook.acceptCall}
            onRejectCall={callHook.rejectCall}
            onEndCall={callHook.endCall}
            onToggleMute={callHook.toggleMute}
            onToggleHold={callHook.toggleHold}
            onSendDTMF={callHook.sendDTMF}
            formatPhoneNumber={formatPhoneNumber}
            availablePhoneNumbers={callHook.availablePhoneNumbers}
            phoneNumbers={callHook.availablePhoneNumbers}
            callHook={callHook}
          />
        </div>
      )}
    </CallContext.Provider>
  )
}

export function useCallContext() {
  return useContext(CallContext)
}
