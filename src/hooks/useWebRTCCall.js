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
  const ringtoneRef = useRef(null)
  const outboundCallIdRef = useRef(null) // Track our outbound call ID
  const isInitiatingOutboundRef = useRef(false) // Set true BEFORE newCall() to block race
  const availablePhoneNumbersRef = useRef([]) // Mirror of state for stale-closure-safe access
  const currentCallRef = useRef(null) // Mirror for stale-closure-safe access
  const isCallActiveRef = useRef(false) // Mirror for stale-closure-safe access
  const handleCallUpdateRef = useRef(null) // Always-current handler ref

  // Keep refs in sync with state (so event handlers registered once always see current values)
  // These run after every render — no deps array
  availablePhoneNumbersRef.current = availablePhoneNumbers
  currentCallRef.current = currentCall
  isCallActiveRef.current = isCallActive

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

  const playRingtone = () => {
    try {
      if (ringtoneRef.current) return // already playing
      const audio = new Audio('/call.mp3')
      audio.loop = true
      audio.volume = 0.7
      ringtoneRef.current = audio
      const attemptPlay = () => {
        audio.play().catch(e => {
          if (e.name === 'NotAllowedError') {
            // Tab not focused — retry on next user interaction
            console.warn('Ringtone blocked (tab not focused), waiting for interaction')
            const resume = () => {
              if (ringtoneRef.current === audio) {
                audio.play().catch(() => {})
              }
              document.removeEventListener('click', resume)
              document.removeEventListener('keydown', resume)
              document.removeEventListener('visibilitychange', resume)
            }
            document.addEventListener('click', resume, { once: true })
            document.addEventListener('keydown', resume, { once: true })
            document.addEventListener('visibilitychange', resume, { once: true })
          } else {
            console.warn('Ringtone play failed:', e.message)
          }
        })
      }
      attemptPlay()
    } catch (e) { console.warn('Ringtone error:', e) }
  }

  const stopRingtone = () => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause()
      ringtoneRef.current.currentTime = 0
      ringtoneRef.current = null
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

  // Stop ringtone
  stopRingtone()

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
  
  // Sync refs IMMEDIATELY so the next callUpdate sees clean state
  // (don't wait for React re-render which may be too slow)
  currentCallRef.current = null
  isCallActiveRef.current = false
  outboundCallIdRef.current = null
  isInitiatingOutboundRef.current = false
  pendingParticipantRef.current = null

  // Reset all call-related state
  setIsCallActive(false)
  setCurrentCall(null)
  setIncomingCall(null)
  setCallStatus('idle')
  setCallDuration(0)
  setIsOnHold(false)
  setIsMuted(false)
  setConferenceStatus('')
  setParticipantCalls([])
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
  
  // Detect incoming call via callUpdate
  // Use refs (not state) — this handler may be stale-closed from initial render
  const isOurOutboundCall = isInitiatingOutboundRef.current || outboundCallIdRef.current === call.id
  if (!isOurOutboundCall && !currentCallRef.current && !isCallActiveRef.current && (call.state === 'ringing' || call.state === 'new')) {
    const hasDestination = call.params?.destination_number || call.options?.destinationNumber
    const hasCaller = call.params?.caller_id_number || call.options?.remoteCallerNumber

    if (call.direction === 'outbound' || (hasDestination && !hasCaller)) {
      console.log('Skipping outbound call from incoming detection:', call.id)
      // fall through to main call handler
    } else {
      // Filter: only ring if destination matches one of our workspace phone numbers
      const incomingTo = call.params?.destination_number || call.params?.destinationNumber || ''
      const incomingToDigits = incomingTo.replace(/\D/g, '').slice(-10)
      const numbers = availablePhoneNumbersRef.current

      // Block when numbers not loaded — prevents cross-workspace ring
      if (numbers.length === 0) {
        console.log('[WebRTC] Phone numbers not loaded, blocking callUpdate incoming')
        return
      }

      const isOurNumber = numbers.some(p => p.phoneNumber?.replace(/\D/g, '').slice(-10) === incomingToDigits)
      if (incomingToDigits && !isOurNumber) {
        console.log('[WebRTC] callUpdate: incoming to', incomingTo, 'not our number, ignoring')
        return
      }

      const callerNumber = call.params?.caller_id_number
        || call.params?.callerIdNumber
        || call.options?.remoteCallerNumber
        || call.options?.caller_id_number
        || call.remoteCallerNumber
        || call.params?.from
        || 'Unknown'
      const destNumber = call.params?.destination_number
        || call.params?.destinationNumber
        || call.options?.destinationNumber
        || call.options?.destination_number
        || call.params?.to
        || ''

      console.log('Detected incoming call:', callerNumber, '->', destNumber)
      playRingtone()
      setCurrentCall(call)
      setIncomingCall({ from: callerNumber, to: destNumber, callId: call.id })
      setIsCallActive(true)
      setCallStatus('incoming')
      return
    }
  }

  // Handle main call updates
  if (!currentCallRef.current || call.id === currentCallRef.current.id) {
    switch (call.state) {
      case 'requesting':
      case 'trying':
        setCallStatus('trying')
        break
      case 'active':
        if (callStatus !== 'conference') {
          setCallStatus('active')
        }
        setIncomingCall(null)
        setupAudioRouting(call, false)
        startCallTimer()
        break
      case 'held':
        setCallStatus('held')
        setIsOnHold(true)
        break
      case 'ringing':
        if (callStatus !== 'incoming') {
          setCallStatus('ringing')
        }
        break
      case 'hangup':
        console.log('Main call hangup detected')
        stopRingtone()
        // Sync refs now so any rapid next call isn't blocked
        currentCallRef.current = null
        isCallActiveRef.current = false
        setCallStatus('ended')
        cleanupTimeoutRef.current = setTimeout(() => {
          performCompleteCleanup()
        }, 800)
        break
      case 'destroy':
        console.log('Main call destroy detected')
        // Cancel pending hangup cleanup to avoid double-run
        if (cleanupTimeoutRef.current) {
          clearTimeout(cleanupTimeoutRef.current)
          cleanupTimeoutRef.current = null
        }
        performCompleteCleanup()
        break
    }

    setCurrentCall(call)
  }
}

// Keep ref pointing to latest closure so the once-registered listener always calls current version
handleCallUpdateRef.current = handleCallUpdate

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

        // Build auth headers once — reused for SIP creds + phone numbers fetch
        const userSession = localStorage.getItem('user_session')
        const sessionUser = userSession ? JSON.parse(userSession) : null
        const headers = { 'Content-Type': 'application/json' }
        if (sessionUser) {
          headers['x-user-id'] = sessionUser.userId || ''
          headers['x-workspace-id'] = sessionUser.workspaceId || ''
          headers['x-messaging-profile-id'] = sessionUser.messagingProfileId || ''
        }

        // Fetch workspace-specific SIP credentials (auto-provisions if first time)
        let sipUsername, sipPassword
        try {
          const credsRes = await fetch('/api/workspace/sip-credentials', { headers })
          const credsData = await credsRes.json()
          if (!credsData.success || !credsData.sipUsername) {
            throw new Error(credsData.error || 'Failed to get SIP credentials')
          }
          sipUsername = credsData.sipUsername
          sipPassword = credsData.sipPassword
          console.log('[WebRTC] Using workspace SIP credential:', sipUsername)
        } catch (e) {
          // Fallback to shared env var credential (legacy)
          console.warn('[WebRTC] Could not get workspace SIP creds, falling back to env:', e.message)
          sipUsername = process.env.NEXT_PUBLIC_TELNYX_SIP_USERNAME
          sipPassword = process.env.NEXT_PUBLIC_TELNYX_SIP_PASSWORD
        }

        if (!sipUsername || !sipPassword) {
          console.error('Missing WebRTC SIP credentials')
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
          login: sipUsername,
          password: sipPassword,
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
            // Use ref so we always call the latest closure (avoids stale closure bug)
            handleCallUpdateRef.current?.(notification.call)
          }
        })

        telnyxClient.on('telnyx.call.receive', (call) => {
          console.log('telnyx.call.receive fired:', call.id, 'state:', call.state, 'params:', call.params)

          // This event ONLY fires for true incoming calls — no need for outbound check.
          // Use refs so we always read current values (not stale closure).
          if (currentCallRef.current || isCallActiveRef.current) {
            console.log('Already on a call, ignoring incoming')
            return
          }

          // Workspace filter: only ring if the destination matches one of our numbers.
          // If numbers haven't loaded, BLOCK — better to miss than to ring wrong workspace.
          const incomingTo = call.params?.destination_number || call.params?.destinationNumber || ''
          const incomingToDigits = incomingTo.replace(/\D/g, '').slice(-10)
          const numbers = availablePhoneNumbersRef.current

          if (numbers.length === 0) {
            console.log('[WebRTC] Phone numbers not loaded yet, blocking incoming call')
            return
          }

          const isOurNumber = numbers.some(p => p.phoneNumber?.replace(/\D/g, '').slice(-10) === incomingToDigits)
          if (!isOurNumber) {
            console.log('[WebRTC] Incoming call to', incomingTo, 'not our number, ignoring')
            return
          }

          const callerNumber = call.params?.caller_id_number
            || call.params?.callerIdNumber
            || call.options?.remoteCallerNumber
            || call.params?.from
            || 'Unknown'
          const destNumber = incomingTo

          console.log('Incoming call accepted:', callerNumber, '->', destNumber)
          playRingtone()
          setCurrentCall(call)
          setIncomingCall({ from: callerNumber, to: destNumber, callId: call.id })
          setIsCallActive(true)
          setCallStatus('incoming')
        })

        // Load phone numbers BEFORE connecting so the incoming call filter is ready
        try {
          const numRes = await fetch('/api/phone-numbers', { headers })
          const numData = await numRes.json()
          if (numData.success && numData.phoneNumbers) {
            const voiceNums = numData.phoneNumbers.filter(p =>
              p.capabilities?.includes('voice') || p.capabilities?.includes('Voice')
            )
            availablePhoneNumbersRef.current = voiceNums
            setAvailablePhoneNumbers(voiceNums)
            if (voiceNums.length > 0) setSelectedCallerNumber(voiceNums[0].phoneNumber)
            console.log('[WebRTC] Loaded', voiceNums.length, 'phone numbers for call filtering')
          }
        } catch (e) {
          console.error('[WebRTC] Failed to load phone numbers:', e.message)
        }

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

  // Phone numbers are loaded inside initializeClient() before SDK connects.
  // This keeps the ref populated before any calls can arrive.

  // Log outbound call to DB (uses workspace headers)
  const logCallToDb = async (toNumber, fromNumber, callControlId, conversationId) => {
    try {
      const userSession = typeof window !== 'undefined' ? localStorage.getItem('user_session') : null
      const user = userSession ? JSON.parse(userSession) : null
      const headers = { 'Content-Type': 'application/json' }
      if (user) {
        headers['x-user-id'] = user.userId || ''
        headers['x-workspace-id'] = user.workspaceId || ''
        headers['x-messaging-profile-id'] = user.messagingProfileId || ''
      }
      const res = await fetch('/api/calls/log', { method: 'POST', headers, body: JSON.stringify({ toNumber, fromNumber, callControlId, conversationId }) })
      const data = await res.json()
      if (data.success) console.log('Call logged to DB:', data.callId)
    } catch (err) {
      console.error('Failed to log call to DB:', err)
    }
  }

  // Main call functions
  const initiateCall = async (phoneNumber, fromNumber = null, conversationId = null) => {
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

      // Set flag BEFORE newCall() — prevents any synchronous callUpdate from being treated as incoming
      isInitiatingOutboundRef.current = true

      const call = client.newCall({
        destinationNumber: formattedDestination,
        callerNumber: formattedCaller,
        callerName: 'SMS Dashboard'
      })

      // Store call ID and clear the boolean flag
      outboundCallIdRef.current = call.id
      isInitiatingOutboundRef.current = false
      // Sync refs immediately — don't wait for React re-render
      currentCallRef.current = call
      isCallActiveRef.current = true

      setCurrentCall(call)
      setIsCallActive(true)
      setCallStatus('connecting')

      // Call records are created by the Telnyx webhook — no need to log from UI

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
      stopRingtone()
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
      stopRingtone()
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

// Mute toggle — tries every known approach
const toggleMute = async () => {
  if (!currentCall) {
    console.error('No active call to mute/unmute')
    return
  }

  const newMuteState = !isMuted

  try {
    console.log('Mute toggle - current:', isMuted, '-> target:', newMuteState)
    console.log('Available mute methods:', {
      muteAudio: typeof currentCall.muteAudio,
      unmuteAudio: typeof currentCall.unmuteAudio,
      toggleAudioMute: typeof currentCall.toggleAudioMute,
      mute: typeof currentCall.mute,
      unmute: typeof currentCall.unmute,
      peer: !!currentCall.peer,
      localStream: !!currentCall.localStream
    })

    let success = false

    // Approach 1: Telnyx SDK muteAudio/unmuteAudio
    if (!success && typeof currentCall.muteAudio === 'function') {
      try {
        if (newMuteState) { currentCall.muteAudio() } else { currentCall.unmuteAudio() }
        console.log('SDK muteAudio/unmuteAudio called')
        success = true
      } catch (e) { console.warn('SDK muteAudio failed:', e.message) }
    }

    // Approach 2: Access RTCPeerConnection via peer.instance and disable audio sender tracks
    const pc = currentCall.peer?.instance || currentCall.peer
    if (pc && typeof pc.getSenders === 'function') {
      try {
        const senders = pc.getSenders()
        senders.forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !newMuteState
            console.log('PeerConnection sender audio track enabled:', !newMuteState)
            success = true
          }
        })
      } catch (e) { console.warn('PeerConnection mute failed:', e.message) }
    }

    // Approach 3: Access localStream audio tracks directly
    if (!success) {
      const stream = currentCall.localStream || currentCall.options?.localStream
      if (stream) {
        stream.getAudioTracks().forEach(track => {
          track.enabled = !newMuteState
          console.log('LocalStream audio track enabled:', !newMuteState)
          success = true
        })
      }
    }

    // Approach 4: Find any audio element with local stream
    if (!success) {
      try {
        const audioEl = document.getElementById('remoteAudio')
        if (audioEl?.srcObject) {
          audioEl.srcObject.getAudioTracks().forEach(track => {
            track.enabled = !newMuteState
            console.log('Audio element track enabled:', !newMuteState)
            success = true
          })
        }
      } catch (e) { console.warn('Audio element mute failed:', e.message) }
    }

    if (success) {
      setIsMuted(newMuteState)
      console.log('Mute state set to:', newMuteState)
    } else {
      console.error('All mute approaches failed')
    }
  } catch (error) {
    console.error('Error in toggleMute:', error)
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

    isInitiatingOutboundRef.current = true
    const participantCall = client.newCall({
      destinationNumber: formattedNumber,
      callerNumber: formattedCaller,
      callerName: 'Conference Call'
    })
    isInitiatingOutboundRef.current = false
    
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