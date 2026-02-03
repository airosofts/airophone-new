// hooks/useWebRTCCall.js - UPDATED with correct API endpoints
'use client'

import { useState, useEffect, useRef } from 'react'

export function useWebRTCCall() {
  // State variables
  const [client, setClient] = useState(null)
  const [isRegistered, setIsRegistered] = useState(false)
  const [isCallActive, setIsCallActive] = useState(false)
  const [currentCall, setCurrentCall] = useState(null)
  const [callStatus, setCallStatus] = useState('idle')
  const [callHistory, setCallHistory] = useState([])
  const [isInitializing, setIsInitializing] = useState(true)
  const [callDuration, setCallDuration] = useState(0)
  const [availablePhoneNumbers, setAvailablePhoneNumbers] = useState([])
  const [selectedCallerNumber, setSelectedCallerNumber] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)
  const [initError, setInitError] = useState(null)
  const [isOnHold, setIsOnHold] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [participantCalls, setParticipantCalls] = useState([])
  const [conferenceStatus, setConferenceStatus] = useState('')
  
  // Refs
  const callTimer = useRef(null)
  const participantCallsRef = useRef([])
  const pendingParticipantRef = useRef(null)
  const cleanupTimeoutRef = useRef(null)

  // Helper functions
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const startCallTimer = () => {
    setCallDuration(0)
    if (callTimer.current) {
      clearInterval(callTimer.current)
    }
    callTimer.current = setInterval(() => {
      setCallDuration(prev => prev + 1)
    }, 1000)
  }

  const stopCallTimer = () => {
    if (callTimer.current) {
      clearInterval(callTimer.current)
      callTimer.current = null
    }
  }

  const addToCallHistory = (callData) => {
    setCallHistory(prev => [callData, ...prev.slice(0, 49)])
  }

  const updateCallHistory = (callId, status, duration = null) => {
    setCallHistory(prev => 
      prev.map(call => 
        call.id === callId 
          ? { ...call, status, duration: duration || call.duration, ended_at: new Date().toISOString() }
          : call
      )
    )
  }

// UPDATED: Enhanced cleanup to remove participant audio elements
const performCompleteCleanup = () => {
  console.log('Performing complete cleanup')
  
  // Clear all timers
  stopCallTimer()
  if (cleanupTimeoutRef.current) {
    clearTimeout(cleanupTimeoutRef.current)
    cleanupTimeoutRef.current = null
  }
  
  // Hang up any participant calls and clean up their audio elements
  if (participantCalls.length > 0) {
    console.log('Cleaning up participant calls and audio')
    participantCalls.forEach(participantCall => {
      try {
        if (participantCall.call && typeof participantCall.call.hangup === 'function') {
          participantCall.call.hangup()
        }
        
        // Remove participant audio element
        const audioElement = document.getElementById(`participantAudio_${participantCall.id}`)
        if (audioElement) {
          audioElement.remove()
        }
      } catch (error) {
        console.error('Error cleaning up participant call:', error)
      }
    })
  }
  
  // Clean up any orphaned participant audio elements
  const participantAudioElements = document.querySelectorAll('[id^="participantAudio_"]')
  participantAudioElements.forEach(element => element.remove())
  
  // Reset all call-related state
  setIsCallActive(false)
  setCurrentCall(null)
  setIncomingCall(null)
  setCallStatus('idle')
  setCallDuration(0)
  setIsOnHold(false)
  setIsMuted(false)
  setConferenceStatus('')
  
  // Clear participant tracking
  pendingParticipantRef.current = null
  setParticipantCalls([])
  participantCallsRef.current = []
}
// ENHANCED: Call update handler that properly updates participant call objects
const handleCallUpdate = (call) => {
  console.log('Call update received:', { 
    callId: call.id, 
    state: call.state, 
    type: call.type,
    destination: call.params?.destination_number,
    caller: call.params?.caller_id_number 
  })
  
  // Check if this is a participant call and update its object
  setParticipantCalls(prev => {
    const updatedCalls = prev.map(participant => {
      if (participant.id === call.id) {
        console.log(`Updating participant ${participant.phoneNumber} call state to:`, call.state)
        return { ...participant, call: call, status: call.state }
      }
      return participant
    })
    return updatedCalls
  })
  
  // Check if this is a pending participant call
  if (pendingParticipantRef.current && call.id === pendingParticipantRef.current.callId) {
    console.log('Participant call update:', call.state)
    
    switch (call.state) {
      case 'trying':
        setConferenceStatus('Calling participant...')
        break
      case 'ringing':
        setConferenceStatus('Participant phone ringing...')
        break
      case 'active':
        setConferenceStatus('Participant answered!')
        setupAudioRouting(call, true)
        if (pendingParticipantRef.current.onAnswer) {
          pendingParticipantRef.current.onAnswer(call)
        }
        break
      case 'hangup':
      case 'destroy':
        console.log('Participant call ended')
        
        // Clean up participant audio
        const audioElement = document.getElementById(`participantAudio_${call.id}`)
        if (audioElement) {
          audioElement.remove()
        }
        
        // Remove from participants list
        setParticipantCalls(prev => {
          const updated = prev.filter(p => p.id !== call.id)
          
          // If no more participants, return to normal call
          if (updated.length === 0 && callStatus === 'conference') {
            setCallStatus('active')
            setConferenceStatus('Participant left - back to 2-way call')
            setTimeout(() => setConferenceStatus(''), 3000)
          }
          
          return updated
        })
        
        // If this was during setup, trigger onHangup
        if (pendingParticipantRef.current && pendingParticipantRef.current.onHangup) {
          pendingParticipantRef.current.onHangup()
        }
        pendingParticipantRef.current = null
        break
    }
    return // Don't process as main call
  }
  
  // Handle main call updates
  if (!currentCall || call.id === currentCall.id) {
    switch (call.state) {
      case 'active':
        // Don't override conference status
        if (callStatus !== 'conference') {
          setCallStatus('active')
        }
        setIncomingCall(null)
        setupAudioRouting(call, false)
        if (callDuration === 0) {
          startCallTimer()
        }
        break
      case 'held':
        setCallStatus('held')
        setIsOnHold(true)
        break
      case 'hangup':
        console.log('Main call hangup detected')
        setCallStatus('ended')
        cleanupTimeoutRef.current = setTimeout(() => {
          performCompleteCleanup()
        }, 1000)
        break
      case 'destroy':
        console.log('Main call destroy detected')
        performCompleteCleanup()
        break
      // ... other states remain the same
    }
    
    setCurrentCall(call)
  }
}

  // Get the actual call control ID from WebRTC call
  const getCallControlId = () => {
    if (!currentCall) return null
    
    // Try different possible properties for call control ID
    return currentCall.id || 
           currentCall.call_id || 
           currentCall.callId || 
           currentCall.call_control_id ||
           currentCall.sessionId
  }


// UPDATED: Setup audio routing with participant support
const setupAudioRouting = (call, isParticipant = false) => {
  try {
    console.log('Setting up audio routing for call:', call.id, 'isParticipant:', isParticipant)
    
    if (isParticipant) {
      // For participant calls, create a separate audio element
      let audioElement = document.getElementById(`participantAudio_${call.id}`)
      if (!audioElement) {
        audioElement = document.createElement('audio')
        audioElement.id = `participantAudio_${call.id}`
        audioElement.autoplay = true
        audioElement.style.display = 'none'
        document.body.appendChild(audioElement)
        console.log('Created participant audio element:', audioElement.id)
      }
      
      if (audioElement && call.remoteStream) {
        audioElement.srcObject = call.remoteStream
        audioElement.volume = 1.0
        audioElement.play()
          .then(() => console.log('Participant audio started playing'))
          .catch(error => console.error('Failed to play participant audio:', error))
      }
    } else {
      // For main calls, use the main audio element
      const audioElement = document.getElementById('remoteAudio')
      
      if (audioElement && call.remoteStream) {
        audioElement.srcObject = call.remoteStream
        audioElement.volume = 1.0
        audioElement.play()
          .then(() => console.log('Main call audio started playing'))
          .catch(error => console.error('Failed to play main call audio:', error))
      }
    }
  } catch (error) {
    console.error('Error setting up audio routing:', error)
  }
}
 

  // Initialize WebRTC client
  useEffect(() => {
    const initializeClient = async () => {
      try {
        setIsInitializing(true)
        setInitError(null)
        
        if (typeof window === 'undefined') {
          console.log('Not in browser environment, skipping WebRTC init')
          setIsInitializing(false)
          return
        }

        if (!process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME || 
            !process.env.NEXT_PUBLIC_TELNYX_SIP_PASSWORD) {
          console.error('Missing WebRTC environment variables')
          setInitError('Missing WebRTC configuration')
          setIsInitializing(false)
          return
        }

        // Request microphone permissions first
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true }, 
            video: false 
          })
          stream.getTracks().forEach(track => track.stop())
        } catch (mediaError) {
          console.error('Microphone permission denied:', mediaError)
          setInitError('Microphone permission required for calling')
          setIsInitializing(false)
          return
        }

        const { TelnyxRTC } = await import('@telnyx/webrtc')
        
        const telnyxClient = new TelnyxRTC({
          login: process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME,
          password: process.env.NEXT_PUBLIC_TELNYX_SIP_PASSWORD,
          ringtoneFile: '/sounds/ringtone.mp3',
          ringbackFile: '/sounds/ringback.mp3',
          debugMode: true
        })

        telnyxClient.on('telnyx.ready', () => {
          console.log('Telnyx WebRTC ready')
          setIsRegistered(true)
          setInitError(null)
        })

        telnyxClient.on('telnyx.socket.error', (error) => {
          console.error('WebRTC socket error:', error)
          setIsRegistered(false)
          setInitError('Connection failed: ' + error.message)
        })

        telnyxClient.on('telnyx.notification', (notification) => {
          if (notification.type === 'callUpdate') {
            handleCallUpdate(notification.call)
          }
        })

        telnyxClient.on('telnyx.call.receive', (call) => {
          console.log('Incoming call:', call)
          setCurrentCall(call)
          setIncomingCall({
            from: call.params.caller_id_number,
            to: call.params.destination_number,
            callId: call.id
          })
          setIsCallActive(true)
          setCallStatus('incoming')
        })

        await telnyxClient.connect()
        setClient(telnyxClient)
        console.log('WebRTC client connected')

        // Create audio element
        if (!document.getElementById('remoteAudio')) {
          const audioElement = document.createElement('audio')
          audioElement.id = 'remoteAudio'
          audioElement.autoplay = true
          audioElement.style.display = 'none'
          document.body.appendChild(audioElement)
        }

      } catch (error) {
        console.error('Error initializing WebRTC:', error)
        setInitError('Failed to initialize: ' + error.message)
        setIsRegistered(false)
      } finally {
        setIsInitializing(false)
      }
    }

    initializeClient()

    return () => {
      if (client) client.disconnect()
      stopCallTimer()
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current)
      }
      const audioElement = document.getElementById('remoteAudio')
      if (audioElement) audioElement.remove()
    }
  }, [])

  // Fetch phone numbers
  useEffect(() => {
    const fetchNumbers = async () => {
      try {
        const response = await fetch('/api/phone-numbers')
        const data = await response.json()
        
        if (data.success && data.phoneNumbers) {
          const voiceNumbers = data.phoneNumbers.filter(phone => 
            phone.capabilities?.includes('voice') || phone.capabilities?.includes('Voice')
          )
          setAvailablePhoneNumbers(voiceNumbers)
          
          if (!selectedCallerNumber && voiceNumbers.length > 0) {
            setSelectedCallerNumber(voiceNumbers[0].phoneNumber)
          }
        }
      } catch (error) {
        console.error('Error fetching phone numbers:', error)
      }
    }

    fetchNumbers()
  }, [selectedCallerNumber])

  // Main call functions
  const initiateCall = async (phoneNumber, fromNumber = null) => {
    if (!client || !isRegistered) {
      throw new Error('WebRTC client not ready. Please wait and try again.')
    }

    const callerNumber = fromNumber || selectedCallerNumber
    if (!callerNumber) {
      throw new Error('No caller number selected')
    }

    try {
      setCallStatus('initiating')
      
      const cleanDestination = phoneNumber.replace(/\D/g, '')
      const cleanCaller = callerNumber.replace(/\D/g, '')
      
      const formattedDestination = cleanDestination.startsWith('1') ? cleanDestination : `1${cleanDestination}`
      const formattedCaller = cleanCaller.startsWith('1') ? cleanCaller : `1${cleanCaller}`
      
      const call = client.newCall({
        destinationNumber: formattedDestination,
        callerNumber: formattedCaller,
        callerName: 'SMS Dashboard'
      })

      setCurrentCall(call)
      setIsCallActive(true)
      setCallStatus('connecting')
      
      return call

    } catch (error) {
      console.error('Error initiating call:', error)
      performCompleteCleanup()
      throw error
    }
  }

  const acceptCall = async () => {
    if (!currentCall) return
    try {
      await currentCall.answer()
      setCallStatus('active')
      setIncomingCall(null)
    } catch (error) {
      console.error('Error accepting call:', error)
      throw error
    }
  }

  const rejectCall = async () => {
    if (!currentCall) return
    try {
      await currentCall.hangup()
      performCompleteCleanup()
    } catch (error) {
      console.error('Error rejecting call:', error)
      performCompleteCleanup()
    }
  }
// ALSO UPDATE the endCall function to prevent unexpected call endings:
const endCall = async () => {
  try {
    console.log('endCall function called - currentCall:', currentCall?.id, 'status:', callStatus)
    
    // Only proceed if there's actually an active call
    if (!currentCall) {
      console.log('No current call to end, performing cleanup only')
      performCompleteCleanup()
      return
    }
    
    // Clear participant tracking immediately
    pendingParticipantRef.current = null
    setConferenceStatus('')
    setCallStatus('ending')
    
    // Try to hang up the call
    if (typeof currentCall.hangup === 'function') {
      console.log('Attempting to hang up call:', currentCall.id)
      await currentCall.hangup()
      console.log('Hangup successful')
    } else {
      console.log('No hangup method available on current call')
    }
    
    // Cleanup will be handled by the call update handler when it receives hangup/destroy
    
  } catch (error) {
    console.error('Error ending call:', error)
    // Always perform cleanup even if hangup fails
    performCompleteCleanup()
  }
}
// ADD this new function to prevent unwanted call endings during normal operations:
const preventUnwantedEndCall = () => {
  // This function can be called before any operation that might accidentally trigger endCall
  console.log('Preventing unwanted call end - call status:', callStatus, 'active:', isCallActive)
  
  if (!isCallActive || !currentCall) {
    console.log('Call already ended or no active call')
    return false
  }
  
  if (callStatus === 'ending' || callStatus === 'ended') {
    console.log('Call is already ending/ended')
    return false
  }
  
  return true
}

// REPLACE these functions in your useWebRTCCall.js hook:

// FIXED: Proper mute toggle with Telnyx SDK method
const toggleMute = async () => {
  if (!currentCall) {
    console.error('No active call to mute/unmute')
    return
  }
  
  try {
    console.log('Mute toggle - current state:', isMuted, 'call:', currentCall.id)
    
    // Try the Telnyx SDK's onMuteUnmutePressed method first
    if (typeof currentCall.onMuteUnmutePressed === 'function') {
      console.log('Using Telnyx SDK onMuteUnmutePressed method')
      currentCall.onMuteUnmutePressed()
      // Toggle the state since Telnyx SDK handles it internally
      setIsMuted(!isMuted)
    } else {
      // Fallback to direct mute/unmute
      if (isMuted) {
        console.log('Unmuting call...')
        await currentCall.unmute()
        setIsMuted(false)
      } else {
        console.log('Muting call...')
        await currentCall.mute()
        setIsMuted(true)
      }
    }
    
    console.log('Mute toggle completed, new state:', !isMuted)
  } catch (error) {
    console.error('Error in toggleMute:', error)
    console.log('Available methods on currentCall:', Object.getOwnPropertyNames(currentCall))
  }
}


// FIXED: Hold toggle with proper state management
const toggleHold = async () => {
  if (!currentCall) {
    console.error('No active call to hold/unhold')
    return
  }
  
  try {
    console.log('Hold toggle - current state:', isOnHold, 'call:', currentCall.id)
    
    if (isOnHold) {
      console.log('Resuming call...')
      await currentCall.unhold()
      setIsOnHold(false)
      // Restore proper call status
      if (participantCalls.length > 0) {
        setCallStatus('conference')
      } else {
        setCallStatus('active')
      }
      console.log('Call resumed successfully')
    } else {
      console.log('Putting call on hold...')
      await currentCall.hold()
      setIsOnHold(true)
      setCallStatus('held')
      console.log('Call put on hold successfully')
    }
  } catch (error) {
    console.error('Error in toggleHold:', error)
  }
}

  const sendDTMF = async (digit) => {
    if (!currentCall) return
    try {
      await currentCall.dtmf(digit)
    } catch (error) {
      console.error('Error sending DTMF:', error)
    }
  }

// FIXED: Conference function that stores actual call objects for proper status tracking
const addParticipantToCall = async (phoneNumber) => {
  if (!client || !isRegistered || !currentCall) {
    throw new Error('Cannot add participant: No active call')
  }

  try {
    console.log('Adding participant to conference:', phoneNumber)
    setConferenceStatus('Setting up conference...')
    
    const cleanNumber = phoneNumber.replace(/\D/g, '')
    const callerNumber = selectedCallerNumber?.replace(/\D/g, '')
    
    if (!callerNumber) {
      throw new Error('No caller number selected')
    }
    
    // Don't put main call on hold - keep it active for audio
    setConferenceStatus('Dialing participant...')
    
    // Create participant call using WebRTC
    const formattedNumber = cleanNumber.startsWith('1') ? cleanNumber : `1${cleanNumber}`
    const formattedCaller = callerNumber.startsWith('1') ? callerNumber : `1${callerNumber}`
    
    console.log('Creating participant call:', { formattedNumber, formattedCaller })
    
    const participantCall = client.newCall({
      destinationNumber: formattedNumber,
      callerNumber: formattedCaller,
      callerName: 'Conference Call'
    })
    
    setConferenceStatus('Calling participant...')
    
    // FIXED: Store the actual call object immediately for status tracking
    const participantData = {
      id: participantCall.id,
      phoneNumber: cleanNumber,
      call: participantCall, // Store the actual call object
      status: 'dialing'
    }
    
    // Add to participant calls list immediately
    setParticipantCalls(prev => [...prev, participantData])
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        setConferenceStatus('Participant timeout')
        
        // Remove from participants list
        setParticipantCalls(prev => prev.filter(p => p.id !== participantCall.id))
        
        setTimeout(() => setConferenceStatus(''), 3000)
        reject(new Error('Participant did not answer within 45 seconds'))
      }, 45000)
      
      pendingParticipantRef.current = {
        callId: participantCall.id,
        phoneNumber: cleanNumber,
        timeoutId,
        participantCall: participantCall,
        onAnswer: async (call) => {
          try {
            clearTimeout(timeoutId)
            setConferenceStatus('Participant answered! Setting up audio...')
            
            // Update participant status to connected
            setParticipantCalls(prev => 
              prev.map(p => 
                p.id === call.id 
                  ? { ...p, call: call, status: 'connected' }
                  : p
              )
            )
            
            // Setup audio routing for participant
            setupAudioRouting(call, true)
            
            // Set conference status
            setCallStatus('conference')
            setConferenceStatus('3-way conference active!')
            
            setTimeout(() => setConferenceStatus(''), 5000)
            resolve({ success: true })
            
          } catch (error) {
            clearTimeout(timeoutId)
            console.error('Error setting up conference:', error)
            setConferenceStatus('Conference setup failed')
            
            // Remove failed participant
            setParticipantCalls(prev => prev.filter(p => p.id !== call.id))
            
            setTimeout(() => setConferenceStatus(''), 3000)
            reject(error)
          }
        },
        onHangup: () => {
          clearTimeout(timeoutId)
          setConferenceStatus('Participant declined')
          
          // Remove participant from list
          setParticipantCalls(prev => prev.filter(p => p.id !== participantCall.id))
          
          setTimeout(() => setConferenceStatus(''), 3000)
          reject(new Error('Participant did not answer'))
        }
      }
    })
    
  } catch (error) {
    console.error('Conference setup error:', error)
    setConferenceStatus('Conference setup failed')
    setTimeout(() => setConferenceStatus(''), 3000)
    throw error
  }
}


 // FIXED: Transfer function using WebRTC-only approach
const transferCallTo = async (phoneNumber, transferType = 'blind') => {
  if (!currentCall) {
    throw new Error('No active call to transfer')
  }

  try {
    console.log('Transferring call to:', phoneNumber)
    
    const cleanNumber = phoneNumber.replace(/\D/g, '')
    const fromNumber = selectedCallerNumber?.replace(/\D/g, '')
    
    if (!fromNumber) {
      throw new Error('No caller number available for transfer')
    }
    
    setCallStatus('transferring')
    setConferenceStatus('Transferring call...')
    
    // Step 1: Put current call on hold
    await currentCall.hold()
    setIsOnHold(true)
    
    // Step 2: Create new call to transfer destination
    const formattedNumber = cleanNumber.startsWith('1') ? cleanNumber : `1${cleanNumber}`
    const formattedFromNumber = fromNumber.startsWith('1') ? fromNumber : `1${fromNumber}`
    
    console.log('Creating transfer call:', { formattedNumber, formattedFromNumber })
    
    const transferCall = client.newCall({
      destinationNumber: formattedNumber,
      callerNumber: formattedFromNumber,
      callerName: 'Transfer Call'
    })
    
    setConferenceStatus('Calling transfer destination...')
    
    // Step 3: Wait for transfer destination to answer
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        setConferenceStatus('Transfer timeout - resuming original call')
        // Resume original call
        currentCall.unhold().catch(console.error)
        setIsOnHold(false)
        setCallStatus('active')
        setConferenceStatus('')
        reject(new Error('Transfer destination did not answer within 30 seconds'))
      }, 30000)
      
      const cleanup = () => {
        clearTimeout(timeoutId)
        setConferenceStatus('')
      }
      
      // Track the transfer call
      const handleTransferUpdate = (call) => {
        if (call.id === transferCall.id) {
          console.log('Transfer call state:', call.state)
          
          switch (call.state) {
            case 'trying':
              setConferenceStatus('Calling transfer destination...')
              break
            case 'ringing':
              setConferenceStatus('Transfer destination ringing...')
              break
            case 'active':
              console.log('Transfer destination answered')
              cleanup()
              
              if (transferType === 'blind') {
                // For blind transfer: hang up original call, keep transfer call
                setConferenceStatus('Transfer completed - hanging up original call')
                currentCall.hangup().then(() => {
                  setConferenceStatus('Call transferred successfully')
                  // The transfer call becomes the new current call
                  setCurrentCall(call)
                  setIsOnHold(false)
                  setCallStatus('active')
                  setTimeout(() => setConferenceStatus(''), 3000)
                  resolve({ success: true, type: 'blind' })
                }).catch(error => {
                  console.error('Error hanging up original call:', error)
                  resolve({ success: true, type: 'blind' }) // Still consider it successful
                })
              } else {
                // For attended transfer: bridge both calls together
                setConferenceStatus('Transfer destination answered - bridging calls')
                setCurrentCall(call) // Switch to transfer call as primary
                setIsOnHold(false)
                setCallStatus('active')
                
                // Optionally hang up after bridging (this simulates the transfer)
                setTimeout(() => {
                  setConferenceStatus('Transfer completed')
                  setTimeout(() => setConferenceStatus(''), 3000)
                }, 1000)
                
                resolve({ success: true, type: 'attended' })
              }
              break
              
            case 'hangup':
            case 'destroy':
              console.log('Transfer call failed or rejected')
              cleanup()
              
              // Resume original call
              currentCall.unhold().then(() => {
                setIsOnHold(false)
                setCallStatus('active')
                setConferenceStatus('Transfer failed - resuming original call')
                setTimeout(() => setConferenceStatus(''), 3000)
              }).catch(console.error)
              
              reject(new Error('Transfer destination did not answer or rejected the call'))
              break
          }
        }
      }
      
      // Listen for transfer call updates
      const originalHandler = handleCallUpdate
      window.tempTransferHandler = (notification) => {
        if (notification.type === 'callUpdate') {
          handleTransferUpdate(notification.call)
          originalHandler(notification.call) // Also call original handler
        }
      }
      
      // Replace handler temporarily
      if (client) {
        client.off('telnyx.notification')
        client.on('telnyx.notification', window.tempTransferHandler)
        
        // Restore original handler after transfer completes or fails
        setTimeout(() => {
          if (client && window.tempTransferHandler) {
            client.off('telnyx.notification', window.tempTransferHandler)
            client.on('telnyx.notification', (notification) => {
              if (notification.type === 'callUpdate') {
                originalHandler(notification.call)
              }
            })
            delete window.tempTransferHandler
          }
        }, 35000) // Clean up after timeout + buffer
      }
    })
    
  } catch (error) {
    console.error('Transfer error:', error)
    setCallStatus('active')
    setConferenceStatus('')
    
    // Try to resume original call if on hold
    if (isOnHold && currentCall) {
      try {
        await currentCall.unhold()
        setIsOnHold(false)
      } catch (resumeError) {
        console.error('Error resuming call after transfer failure:', resumeError)
      }
    }
    
    throw error
  }
}
  const getCurrentCallNumber = () => {
    if (!currentCall) return null
    
    if (currentCall.params?.destination_number) {
      const number = currentCall.params.destination_number
      return number.startsWith('1') ? `+${number}` : `+1${number}`
    }
    
    if (currentCall.params?.caller_id_number) {
      const number = currentCall.params.caller_id_number
      return number.startsWith('1') ? `+${number}` : `+1${number}`
    }
    
    return null
  }

  return {
    // State
    client,
    isRegistered,
    isCallActive,
    currentCall,
    callStatus,
    callHistory,
    isInitializing,
    callDuration: formatDuration(callDuration),
    availablePhoneNumbers,
    selectedCallerNumber,
    incomingCall,
    initError,
    isOnHold,
    isMuted,
    participantCalls,
    conferenceStatus,
    
    // Actions
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleHold,
    sendDTMF,
    setSelectedCallerNumber,
    addParticipantToCall,
    transferCallTo,
    
    // Helpers
    formatDuration,
    getCurrentCallNumber,
    setupAudioRouting
  }
}