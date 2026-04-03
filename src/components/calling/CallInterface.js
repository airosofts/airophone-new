// components/calling/CallInterface.js
'use client'

import { useState, useEffect } from 'react'
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, Grid3X3,
  UserPlus, ArrowRightLeft, X, Minus, Search, User, Loader2
} from 'lucide-react'

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

  const isMuted = callHook?.isMuted || false
  const isOnHold = callHook?.isOnHold || false
  const conferenceStatus = callHook?.conferenceStatus || ''
  const participantCalls = callHook?.participantCalls || []

  useEffect(() => {
    if (callStatus === 'incoming' || callStatus === 'ringing' || callStatus === 'connecting') {
      setIsMinimized(false)
      setShowDialpad(false)
      setShowAddParticipant(false)
      setShowTransfer(false)
    }
  }, [callStatus])

  const fetchContacts = async () => {
    try {
      setLoadingContacts(true)
      const response = await fetch('/api/contacts')
      const data = await response.json()
      if (data.success) setContacts(data.contacts || [])
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setLoadingContacts(false)
    }
  }

  useEffect(() => {
    if (showAddParticipant || showTransfer) fetchContacts()
  }, [showAddParticipant, showTransfer])

  if (!isCallActive) return null

  const handleMuteClick = async () => {
    try {
      if (callHook?.toggleMute) await callHook.toggleMute()
    } catch (error) {
      console.error('Mute error:', error)
    }
  }

  const handleHoldClick = async () => {
    try {
      if (callHook?.toggleHold) await callHook.toggleHold()
    } catch (error) {
      console.error('Hold error:', error)
    }
  }

  const handleEndClick = async () => {
    try {
      if (participantCalls.length > 0) {
        for (const participant of participantCalls) {
          try { if (participant.call?.hangup) await participant.call.hangup() } catch (e) { /* ignore */ }
        }
      }
      if (callHook?.endCall) await callHook.endCall()
      else await onEndCall()
    } catch (error) {
      console.error('End call error:', error)
    }
  }

  const handleDTMF = (digit) => {
    try {
      if (callHook?.currentCall?.dtmf) callHook.currentCall.dtmf(digit)
      else if (onSendDTMF) onSendDTMF(digit)
      setDialpadInput(prev => prev + digit)
    } catch (error) {
      console.error('DTMF error:', error)
    }
  }

  const handleAddParticipant = async (phoneNumber) => {
    try {
      setShowAddParticipant(false)
      if (callHook?.addParticipantToCall) await callHook.addParticipantToCall(phoneNumber)
    } catch (error) {
      console.error('Add participant error:', error)
    }
  }

  const handleTransfer = async (phoneNumber) => {
    try {
      setShowTransfer(false)
      if (callHook?.transferCallTo) await callHook.transferCallTo(phoneNumber)
    } catch (error) {
      console.error('Transfer error:', error)
    }
  }

  const getCallStatusText = () => {
    if (conferenceStatus) return conferenceStatus
    switch (callStatus) {
      case 'incoming': return 'Incoming call'
      case 'connecting': case 'initiating': return 'Connecting...'
      case 'trying': return 'Calling...'
      case 'ringing': return 'Ringing...'
      case 'active': return callDuration
      case 'held': return `On Hold · ${callDuration}`
      case 'conference': return `Conference · ${callDuration}`
      case 'transferring': return 'Transferring...'
      case 'ending': return 'Ending...'
      case 'ended': return 'Call ended'
      default: return 'Connecting...'
    }
  }

  const getPhoneNumber = () => {
    if (incomingCall) return incomingCall.from
    if (currentCall?.params?.destination_number) {
      const n = currentCall.params.destination_number
      return n.startsWith('1') ? `+${n}` : `+1${n}`
    }
    if (currentCall?.params?.caller_id_number) {
      const n = currentCall.params.caller_id_number
      return n.startsWith('1') ? `+${n}` : `+1${n}`
    }
    return 'Unknown'
  }

  const getInitials = () => {
    const num = getPhoneNumber()
    if (num === 'Unknown') return '?'
    return num.replace(/\D/g, '').slice(-2)
  }

  const isConnecting = ['connecting', 'initiating', 'trying', 'ringing'].includes(callStatus)
  const isActive = ['active', 'conference', 'held'].includes(callStatus)

  const filteredContacts = contacts.filter(c =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone_number?.includes(searchQuery)
  )

  const dialpadKeys = [
    ['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['*', '0', '#']
  ]
  const dialpadLetters = { '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '+' }

  const getParticipantStatus = (p) => {
    if (!p.call) return 'Dialing...'
    if (p.call.state === 'active') return 'Connected'
    if (p.call.state === 'ringing') return 'Ringing...'
    if (p.call.state === 'trying') return 'Dialing...'
    if (p.call.state === 'hangup' || p.call.state === 'destroy') return 'Disconnected'
    return 'Connecting...'
  }

  // Minimized pill
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-3 pl-3 pr-4 py-2.5 bg-white rounded-full shadow-lg border border-gray-200 hover:shadow-xl transition-shadow"
        >
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[#C54A3F] flex items-center justify-center text-white text-xs font-semibold">
              {getInitials()}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
              isActive ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400 animate-pulse'
            }`} />
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-900 leading-tight">{formatPhoneNumber(getPhoneNumber())}</p>
            <p className="text-[10px] text-gray-500 leading-tight">{getCallStatusText()}</p>
          </div>
          <div
            className="w-7 h-7 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center ml-1 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleEndClick() }}
          >
            <PhoneOff className="w-3.5 h-3.5 text-[#C54A3F]" />
          </div>
        </button>
      </div>
    )
  }

  return (
    <>
      {/* Main Call Card - Bottom Right */}
      <div className="fixed bottom-6 right-6 z-50 w-72">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">

          {/* Header */}
          <div className="bg-[#C54A3F] px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
                  {getInitials()}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold leading-tight">{formatPhoneNumber(getPhoneNumber())}</p>
                  <p className="text-white/80 text-xs leading-tight mt-0.5">{getCallStatusText()}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  isActive ? 'bg-emerald-300 animate-pulse' :
                  isConnecting ? 'bg-yellow-300 animate-pulse' :
                  'bg-white/40'
                }`} />
                <button
                  onClick={() => setIsMinimized(true)}
                  className="w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
                  title="Minimize"
                >
                  <Minus className="w-3 h-3 text-white" />
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-4 py-3">

            {/* Conference Participants */}
            {participantCalls.length > 0 && (
              <div className="mb-3 p-2.5 bg-gray-50 rounded-lg">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Conference ({participantCalls.length + 1})
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs text-gray-700 font-medium">You</span>
                    </div>
                    <span className="text-[10px] text-emerald-600 font-medium">Host</span>
                  </div>
                  {participantCalls.map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          getParticipantStatus(p) === 'Connected' ? 'bg-emerald-400' :
                          getParticipantStatus(p) === 'Disconnected' ? 'bg-red-400' :
                          'bg-yellow-400 animate-pulse'
                        }`} />
                        <span className="text-xs text-gray-700">{formatPhoneNumber(p.phoneNumber)}</span>
                      </div>
                      <span className={`text-[10px] font-medium ${
                        getParticipantStatus(p) === 'Connected' ? 'text-emerald-600' :
                        getParticipantStatus(p) === 'Disconnected' ? 'text-red-500' :
                        'text-yellow-600'
                      }`}>{getParticipantStatus(p)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Message */}
            {conferenceStatus && (
              <div className="mb-3 px-2.5 py-2 bg-blue-50 rounded-lg flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                <p className="text-xs text-blue-700 font-medium">{conferenceStatus}</p>
              </div>
            )}

            {/* Incoming Call Actions */}
            {callStatus === 'incoming' && (
              <div className="flex justify-center gap-6 py-2">
                <button
                  onClick={onRejectCall}
                  className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white shadow-lg transition-all active:scale-95"
                  title="Decline"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>
                <button
                  onClick={onAcceptCall}
                  className="w-14 h-14 bg-emerald-500 hover:bg-emerald-600 rounded-full flex items-center justify-center text-white shadow-lg transition-all active:scale-95"
                  title="Answer"
                >
                  <Phone className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Active Call Controls */}
            {callStatus !== 'incoming' && (
              <>
                <div className="flex items-center justify-center gap-3">
                  {/* Mute */}
                  <button
                    onClick={handleMuteClick}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                      isMuted
                        ? 'bg-[#C54A3F]/10 text-[#C54A3F] ring-1 ring-[#C54A3F]/30'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  {/* Hold */}
                  <button
                    onClick={handleHoldClick}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                      isOnHold
                        ? 'bg-yellow-50 text-yellow-600 ring-1 ring-yellow-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={isOnHold ? 'Resume' : 'Hold'}
                  >
                    {isOnHold ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>

                  {/* End Call */}
                  <button
                    onClick={handleEndClick}
                    className="w-12 h-12 bg-[#C54A3F] hover:bg-[#B73E34] rounded-full flex items-center justify-center text-white shadow-md transition-all active:scale-95"
                    title="End Call"
                  >
                    <PhoneOff className="w-5 h-5" />
                  </button>

                  {/* Dialpad */}
                  <button
                    onClick={() => { setShowDialpad(!showDialpad); setShowAddParticipant(false); setShowTransfer(false) }}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                      showDialpad
                        ? 'bg-[#C54A3F]/10 text-[#C54A3F] ring-1 ring-[#C54A3F]/30'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title="Dialpad"
                  >
                    <Grid3X3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Secondary actions */}
                <div className="flex justify-center gap-6 mt-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => { setShowAddParticipant(true); setShowDialpad(false); setShowTransfer(false) }}
                    disabled={callStatus === 'transferring'}
                    className="flex flex-col items-center gap-0.5 text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span className="text-[10px] font-medium">Add</span>
                  </button>
                  <button
                    onClick={() => { setShowTransfer(true); setShowDialpad(false); setShowAddParticipant(false) }}
                    disabled={callStatus === 'transferring'}
                    className="flex flex-col items-center gap-0.5 text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    <span className="text-[10px] font-medium">Transfer</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dialpad Panel */}
        {showDialpad && (
          <div className="mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Dialpad</span>
              <button onClick={() => setShowDialpad(false)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                <X className="w-3 h-3 text-gray-500" />
              </button>
            </div>
            {dialpadInput && (
              <div className="px-4 pb-1">
                <div className="bg-gray-50 rounded-lg px-3 py-1.5 flex items-center justify-between">
                  <span className="text-sm font-mono text-gray-800">{dialpadInput}</span>
                  <button onClick={() => setDialpadInput('')} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
            <div className="p-3 grid grid-cols-3 gap-2">
              {dialpadKeys.flat().map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleDTMF(digit)}
                  className="h-12 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95"
                >
                  <span className="text-lg font-semibold text-gray-800 leading-none">{digit}</span>
                  {dialpadLetters[digit] && <span className="text-[8px] text-gray-400 leading-none mt-0.5">{dialpadLetters[digit]}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add Participant Panel */}
        {showAddParticipant && (
          <ContactSearchPanel
            title="Add Participant"
            onClose={() => setShowAddParticipant(false)}
            onSelect={handleAddParticipant}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            contacts={filteredContacts}
            loading={loadingContacts}
            formatPhoneNumber={formatPhoneNumber}
            actionColor="[#C54A3F]"
          />
        )}

        {/* Transfer Panel */}
        {showTransfer && (
          <ContactSearchPanel
            title="Transfer Call"
            onClose={() => setShowTransfer(false)}
            onSelect={handleTransfer}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            contacts={filteredContacts}
            loading={loadingContacts}
            formatPhoneNumber={formatPhoneNumber}
            actionColor="emerald-500"
            isTransfer
          />
        )}
      </div>
    </>
  )
}

// Shared contact search panel for Add Participant / Transfer
function ContactSearchPanel({ title, onClose, onSelect, searchQuery, setSearchQuery, contacts, loading, formatPhoneNumber, isTransfer }) {
  return (
    <div className="mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden max-h-72">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
        <button onClick={onClose} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
          <X className="w-3 h-3 text-gray-500" />
        </button>
      </div>
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Name or phone number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#C54A3F]/40 focus:ring-1 focus:ring-[#C54A3F]/20"
          />
        </div>
      </div>
      <div className="max-h-44 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
          </div>
        ) : contacts.length > 0 ? (
          contacts.map((c) => (
            <button key={c.id} onClick={() => onSelect(c.phone_number)} className="w-full flex items-center gap-2.5 px-2 py-2 hover:bg-gray-50 rounded-lg text-left transition-colors">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                isTransfer ? 'bg-emerald-50 text-emerald-600' : 'bg-[#C54A3F]/10 text-[#C54A3F]'
              }`}>
                {isTransfer ? <ArrowRightLeft className="w-3 h-3" /> : <User className="w-3 h-3" />}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-900">{c.name || 'Unknown'}</p>
                <p className="text-[10px] text-gray-400">{formatPhoneNumber(c.phone_number)}</p>
              </div>
            </button>
          ))
        ) : searchQuery ? (
          <div className="py-4 text-center">
            <button
              onClick={() => onSelect(searchQuery)}
              className={`px-4 py-2 text-white text-xs font-medium rounded-lg transition-colors ${
                isTransfer ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-[#C54A3F] hover:bg-[#B73E34]'
              }`}
            >
              {isTransfer ? 'Transfer to' : 'Call'} {searchQuery}
            </button>
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-gray-400">Enter a number above</div>
        )}
      </div>
    </div>
  )
}
