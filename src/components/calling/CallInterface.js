// components/calling/CallInterface.js - FINAL FIXED VERSION
'use client'

import { useState, useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { 
  faPhone, 
  faPhoneSlash, 
  faMicrophone, 
  faMicrophoneSlash, 
  faPause, 
  faPlay,
  faKeyboard,
  faUserPlus,
  faArrowRightArrowLeft,
  faTimes,
  faSearch,
  faUser,
  faSpinner,
  faMinus
} from '@fortawesome/free-solid-svg-icons'

export default function CallInterface({
  callStatus,
  currentCall,
  incomingCall,
  callDuration,
  isCallActive,
  onAcceptCall,
  onRejectCall,
  onEndCall,
  onToggleMute,
  onToggleHold,
  onSendDTMF,
  formatPhoneNumber,
  callHook
}) {
  const [isMinimized, setIsMinimized] = useState(false)
  const [showDialpad, setShowDialpad] = useState(false)
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [dialpadInput, setDialpadInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [contacts, setContacts] = useState([])
  const [loadingContacts, setLoadingContacts] = useState(false)

  // Get actual states from callHook
  const isMuted = callHook?.isMuted || false
  const isOnHold = callHook?.isOnHold || false
  const conferenceStatus = callHook?.conferenceStatus || ''
  const participantCalls = callHook?.participantCalls || []

  // Reset minimize state for new calls
  useEffect(() => {
    if (callStatus === 'incoming' || callStatus === 'ringing' || callStatus === 'connecting') {
      setIsMinimized(false)
    }
  }, [callStatus])

  const fetchContacts = async () => {
    try {
      setLoadingContacts(true)
      const response = await fetch('/api/contacts')
      const data = await response.json()
      if (data.success) {
        setContacts(data.contacts || [])
      }
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setLoadingContacts(false)
    }
  }

  useEffect(() => {
    if (showAddParticipant || showTransfer) {
      fetchContacts()
    }
  }, [showAddParticipant, showTransfer])

  if (!isCallActive) return null

  // FIXED: Use proper Telnyx SDK mute methods
  const handleMuteClick = async () => {
    try {
      if (callHook?.currentCall) {
        // Use Telnyx SDK's onMuteUnmutePressed method
        if (typeof callHook.currentCall.onMuteUnmutePressed === 'function') {
          callHook.currentCall.onMuteUnmutePressed()
        } else if (isMuted) {
          await callHook.currentCall.unmute()
        } else {
          await callHook.currentCall.mute()
        }
      }
    } catch (error) {
      console.error('Mute error:', error)
    }
  }

  // FIXED: Hold function with proper state update
  const handleHoldClick = async () => {
    try {
      if (callHook?.toggleHold) {
        await callHook.toggleHold()
      } else if (callHook?.currentCall) {
        if (isOnHold) {
          await callHook.currentCall.unhold()
        } else {
          await callHook.currentCall.hold()
        }
      }
    } catch (error) {
      console.error('Hold error:', error)
    }
  }

  // FIXED: Proper conference hangup - ends call for ALL participants
  const handleEndClick = async () => {
    try {
      console.log('Ending call - conference participants:', participantCalls.length)
      
      // If in conference, hang up all participant calls first
      if (participantCalls.length > 0) {
        console.log('Hanging up all participants...')
        for (const participant of participantCalls) {
          try {
            if (participant.call && typeof participant.call.hangup === 'function') {
              await participant.call.hangup()
              console.log('Hung up participant:', participant.phoneNumber)
            }
          } catch (error) {
            console.error('Error hanging up participant:', participant.phoneNumber, error)
          }
        }
      }
      
      // Then hang up the main call
      if (callHook?.endCall) {
        await callHook.endCall()
      } else {
        await onEndCall()
      }
    } catch (error) {
      console.error('End call error:', error)
    }
  }

  const handleDTMF = (digit) => {
    try {
      if (callHook?.currentCall?.dtmf) {
        callHook.currentCall.dtmf(digit)
      } else if (onSendDTMF) {
        onSendDTMF(digit)
      }
      setDialpadInput(prev => prev + digit)
    } catch (error) {
      console.error('DTMF error:', error)
    }
  }

  const handleAddParticipant = async (phoneNumber) => {
    try {
      setShowAddParticipant(false)
      if (callHook?.addParticipantToCall) {
        await callHook.addParticipantToCall(phoneNumber)
      }
    } catch (error) {
      console.error('Add participant error:', error)
      alert(`Failed to add participant: ${error.message}`)
    }
  }

  const handleTransfer = async (phoneNumber) => {
    try {
      setShowTransfer(false)
      if (callHook?.transferCallTo) {
        await callHook.transferCallTo(phoneNumber)
      }
    } catch (error) {
      console.error('Transfer error:', error)
      alert(`Failed to transfer: ${error.message}`)
    }
  }

  const getCallStatusText = () => {
    if (conferenceStatus) return conferenceStatus
    
    switch (callStatus) {
      case 'incoming': return 'Incoming call...'
      case 'connecting': return 'Connecting...'
      case 'trying': return 'Calling...'
      case 'ringing': return 'Ringing...'
      case 'active': return callDuration
      case 'held': return `On Hold • ${callDuration}`
      case 'conference': return `Conference • ${callDuration}`
      case 'transferring': return 'Transferring...'
      case 'ending': return 'Ending call...'
      case 'ended': return 'Call ended'
      default: return 'Call in progress'
    }
  }

  const getPhoneNumber = () => {
    if (incomingCall) return incomingCall.from
    if (currentCall?.params?.destination_number) {
      const number = currentCall.params.destination_number
      return number.startsWith('1') ? `+${number}` : `+1${number}`
    }
    if (currentCall?.params?.caller_id_number) {
      const number = currentCall.params.caller_id_number
      return number.startsWith('1') ? `+${number}` : `+1${number}`
    }
    return 'Unknown'
  }

  const getContactInitials = () => {
    const number = getPhoneNumber()
    if (number === 'Unknown') return '??'
    return number.slice(-4).slice(0, 2)
  }

  const filteredContacts = contacts.filter(contact => 
    contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.phone_number?.includes(searchQuery)
  )

  const dialpadNumbers = [
    [{ digit: '1', letters: '' }, { digit: '2', letters: 'ABC' }, { digit: '3', letters: 'DEF' }],
    [{ digit: '4', letters: 'GHI' }, { digit: '5', letters: 'JKL' }, { digit: '6', letters: 'MNO' }],
    [{ digit: '7', letters: 'PQRS' }, { digit: '8', letters: 'TUV' }, { digit: '9', letters: 'WXYZ' }],
    [{ digit: '*', letters: '' }, { digit: '0', letters: '+' }, { digit: '#', letters: '' }]
  ]

  // FIXED: Get actual participant status based on call state
  const getParticipantStatus = (participant) => {
    if (!participant.call) return 'Dialing...'
    
    const call = participant.call
    if (call.state === 'active') return 'Connected'
    if (call.state === 'ringing') return 'Ringing...'
    if (call.state === 'trying') return 'Dialing...'
    if (call.state === 'hangup' || call.state === 'destroy') return 'Disconnected'
    
    return 'Connecting...'
  }

  const getParticipantDotColor = (participant) => {
    if (!participant.call) return 'bg-yellow-400 animate-pulse'
    
    const call = participant.call
    if (call.state === 'active') return 'bg-green-400'
    if (call.state === 'ringing' || call.state === 'trying') return 'bg-yellow-400 animate-pulse'
    if (call.state === 'hangup' || call.state === 'destroy') return 'bg-red-400'
    
    return 'bg-yellow-400 animate-pulse'
  }

  return (
    <>
      {/* Main Call Window */}
      <div className="fixed top-4 right-4 z-50">
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden w-80">
          {/* Header */}
          <div 
            className="p-4 text-white relative"
            style={{ backgroundColor: '#C54A3F' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 flex-1">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold bg-white bg-opacity-20">
                  {getContactInitials()}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">
                    {formatPhoneNumber(getPhoneNumber())}
                  </h3>
                  <p className="text-white text-opacity-90 text-xs">
                    {getCallStatusText()}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  callStatus === 'active' || callStatus === 'conference' ? 'bg-green-400 animate-pulse' :
                  callStatus === 'ringing' ? 'bg-yellow-400 animate-pulse' :
                  'bg-white bg-opacity-40'
                }`}></div>
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="w-6 h-6 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 flex items-center justify-center transition-colors"
                >
                  <FontAwesomeIcon icon={faMinus} className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          {!isMinimized && (
            <div className="p-4">
              {/* FIXED: Conference Participants with Real Status */}
              {(callStatus === 'conference' || participantCalls.length > 0) && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                    Conference Participants ({participantCalls.length + 1})
                  </h4>
                  <div className="space-y-2">
                    {/* Main caller */}
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-green-400"></div>
                        <span className="text-gray-900 font-medium">
                          You ({formatPhoneNumber(getPhoneNumber())})
                        </span>
                      </div>
                      <span className="text-xs text-green-600 font-medium">Host</span>
                    </div>
                    
                    {/* Participants with REAL status */}
                    {participantCalls.map((participant, index) => (
                      <div key={participant.id} className="flex items-center justify-between text-sm">
                        <div className="flex items-center space-x-2">
                          <div className={`w-2 h-2 rounded-full ${getParticipantDotColor(participant)}`}></div>
                          <span className="text-gray-900 font-medium">
                            Participant {index + 1} ({formatPhoneNumber(participant.phoneNumber)})
                          </span>
                        </div>
                        <span className={`text-xs font-medium ${
                          getParticipantStatus(participant) === 'Connected' ? 'text-green-600' :
                          getParticipantStatus(participant) === 'Disconnected' ? 'text-red-600' :
                          'text-yellow-600'
                        }`}>
                          {getParticipantStatus(participant)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status Messages */}
              {conferenceStatus && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                    <p className="text-sm text-blue-700 font-medium">{conferenceStatus}</p>
                  </div>
                </div>
              )}

              {/* Incoming Call Buttons */}
              {callStatus === 'incoming' && (
                <div className="flex justify-center space-x-6 mb-4">
                  <button
                    onClick={onRejectCall}
                    className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white shadow-lg transition-all transform hover:scale-105"
                  >
                    <FontAwesomeIcon icon={faPhoneSlash} className="w-6 h-6" />
                  </button>
                  <button
                    onClick={onAcceptCall}
                    className="w-16 h-16 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center text-white shadow-lg transition-all transform hover:scale-105"
                  >
                    <FontAwesomeIcon icon={faPhone} className="w-6 h-6" />
                  </button>
                </div>
              )}

              {/* Active Call Controls */}
              {callStatus !== 'incoming' && (
                <div className="space-y-4">
                  {/* Primary Control Row */}
                  <div className="flex justify-center items-center space-x-4">
                    <button
                      onClick={handleMuteClick}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all transform hover:scale-105 ${
                        isMuted 
                          ? 'bg-red-100 text-red-600 border-2 border-red-300 shadow-md' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm'
                      }`}
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      <FontAwesomeIcon 
                        icon={isMuted ? faMicrophoneSlash : faMicrophone} 
                        className="w-4 h-4" 
                      />
                    </button>

                    <button
                      onClick={handleHoldClick}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all transform hover:scale-105 ${
                        isOnHold 
                          ? 'bg-yellow-100 text-yellow-600 border-2 border-yellow-300 shadow-md' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm'
                      }`}
                      title={isOnHold ? 'Resume' : 'Hold'}
                    >
                      <FontAwesomeIcon 
                        icon={isOnHold ? faPlay : faPause} 
                        className="w-4 h-4" 
                      />
                    </button>

                    <button
                      onClick={handleEndClick}
                      className="w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-all transform hover:scale-105"
                      style={{ backgroundColor: '#C54A3F' }}
                      title="End Call"
                    >
                      <FontAwesomeIcon icon={faPhoneSlash} className="w-5 h-5" />
                    </button>

                    <button
                      onClick={() => setShowDialpad(!showDialpad)}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all transform hover:scale-105 ${
                        showDialpad 
                          ? 'text-white border-2 shadow-md' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm'
                      }`}
                      style={showDialpad ? { backgroundColor: '#C54A3F', borderColor: '#C54A3F' } : {}}
                      title="Dialpad"
                    >
                      <FontAwesomeIcon icon={faKeyboard} className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Secondary Controls */}
                  <div className="flex justify-center space-x-8 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => setShowAddParticipant(true)}
                      disabled={callStatus === 'transferring'}
                      className="flex flex-col items-center p-2 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                      title="Add participant to conference"
                    >
                      <FontAwesomeIcon icon={faUserPlus} className="w-4 h-4 text-gray-600 mb-1" />
                      <span className="text-xs text-gray-600 font-medium">Add</span>
                    </button>

                    <button
                      onClick={() => setShowTransfer(true)}
                      disabled={callStatus === 'transferring'}
                      className="flex flex-col items-center p-2 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                      title="Transfer call"
                    >
                      <FontAwesomeIcon icon={faArrowRightArrowLeft} className="w-4 h-4 text-gray-600 mb-1" />
                      <span className="text-xs text-gray-600 font-medium">Transfer</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dialpad Modal */}
      {showDialpad && (
        <div className="fixed top-4 right-4 z-50 mt-20">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden w-80">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900">Dialpad</h4>
                <button
                  onClick={() => setShowDialpad(false)}
                  className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
                >
                  <FontAwesomeIcon icon={faTimes} className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 mb-4 min-h-[48px] flex items-center">
                <span className="text-lg font-mono text-gray-900 flex-1">
                  {dialpadInput || 'Enter digits...'}
                </span>
                {dialpadInput && (
                  <button
                    onClick={() => setDialpadInput('')}
                    className="w-6 h-6 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center transition-colors"
                  >
                    <FontAwesomeIcon icon={faTimes} className="w-3 h-3 text-gray-600" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {dialpadNumbers.flat().map((item) => (
                  <button
                    key={item.digit}
                    onClick={() => handleDTMF(item.digit)}
                    className="h-14 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-lg flex flex-col items-center justify-center text-gray-900 font-semibold transition-all shadow-sm transform hover:scale-105"
                  >
                    <span className="text-xl">{item.digit}</span>
                    {item.letters && (
                      <span className="text-xs text-gray-500">{item.letters}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FIXED: Add Participant Modal - Positioned to the RIGHT */}
      {showAddParticipant && (
        <div className="fixed top-4 right-96 z-50">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-80 max-h-[80vh] overflow-hidden">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900">Add Participant</h4>
                <button
                  onClick={() => setShowAddParticipant(false)}
                  className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
                >
                  <FontAwesomeIcon icon={faTimes} className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              <div className="relative mb-4">
                <FontAwesomeIcon icon={faSearch} className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Search contacts or enter phone number"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-200 focus:border-red-300"
                />
              </div>

              <div className="max-h-60 overflow-y-auto">
                {loadingContacts ? (
                  <div className="text-center py-8">
                    <FontAwesomeIcon icon={faSpinner} className="w-8 h-8 animate-spin text-gray-400" />
                    <p className="text-gray-600 mt-2">Loading contacts...</p>
                  </div>
                ) : filteredContacts.length > 0 ? (
                  filteredContacts.map((contact) => (
                    <div
                      key={contact.id}
                      onClick={() => handleAddParticipant(contact.phone_number)}
                      className="flex items-center p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center mr-3 text-white"
                        style={{ backgroundColor: '#C54A3F' }}
                      >
                        <FontAwesomeIcon icon={faUser} className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{contact.name || 'Unknown Contact'}</p>
                        <p className="text-sm text-gray-500">{formatPhoneNumber(contact.phone_number)}</p>
                      </div>
                    </div>
                  ))
                ) : searchQuery ? (
                  <div className="text-center py-8">
                    <button
                      onClick={() => handleAddParticipant(searchQuery)}
                      className="px-6 py-3 text-white rounded-lg font-medium transition-colors hover:opacity-90"
                      style={{ backgroundColor: '#C54A3F' }}
                    >
                      Call {searchQuery}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FontAwesomeIcon icon={faUser} className="w-8 h-8 text-gray-300 mb-2" />
                    <p>No contacts found</p>
                    <p className="text-sm">Enter a phone number above</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FIXED: Transfer Modal - Positioned to the RIGHT */}
      {showTransfer && (
        <div className="fixed top-4 right-96 z-50">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-80 max-h-[80vh] overflow-hidden">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900">Transfer Call</h4>
                <button
                  onClick={() => setShowTransfer(false)}
                  className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
                >
                  <FontAwesomeIcon icon={faTimes} className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              <div className="relative mb-4">
                <FontAwesomeIcon icon={faSearch} className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Search contacts or enter phone number"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-200 focus:border-red-300"
                />
              </div>

              <div className="max-h-60 overflow-y-auto">
                {loadingContacts ? (
                  <div className="text-center py-8">
                    <FontAwesomeIcon icon={faSpinner} className="w-8 h-8 animate-spin text-gray-400" />
                    <p className="text-gray-600 mt-2">Loading contacts...</p>
                  </div>
                ) : filteredContacts.length > 0 ? (
                  filteredContacts.map((contact) => (
                    <div
                      key={contact.id}
                      onClick={() => handleTransfer(contact.phone_number)}
                      className="flex items-center p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                        <FontAwesomeIcon icon={faArrowRightArrowLeft} className="w-4 h-4 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{contact.name || 'Unknown Contact'}</p>
                        <p className="text-sm text-gray-500">{formatPhoneNumber(contact.phone_number)}</p>
                      </div>
                    </div>
                  ))
                ) : searchQuery ? (
                  <div className="text-center py-8">
                    <button
                      onClick={() => handleTransfer(searchQuery)}
                      className="px-6 py-3 bg-green-500 text-white rounded-lg font-medium transition-colors hover:bg-green-600"
                    >
                      Transfer to {searchQuery}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FontAwesomeIcon icon={faArrowRightArrowLeft} className="w-8 h-8 text-gray-300 mb-2" />
                    <p>No contacts found</p>
                    <p className="text-sm">Enter a phone number above</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}