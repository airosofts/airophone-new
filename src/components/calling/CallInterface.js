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
  const missedCallNotice = callHook?.missedCallNotice || null

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

  if (!isCallActive) {
    if (!missedCallNotice) return null
    return (
      <div className="fixed bottom-6 right-6 z-50 w-72">
        <div className="bg-[#FFFFFF] rounded-2xl shadow-xl border border-[#E3E1DB] overflow-hidden">
          <div className="bg-[#D63B1F] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#FFFFFF]/20 flex items-center justify-center">
                <Phone className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold leading-tight">Missed Call</p>
                <p className="text-white/80 text-xs leading-tight mt-0.5">
                  {formatPhoneNumber ? formatPhoneNumber(missedCallNotice.from) : missedCallNotice.from}
                </p>
              </div>
            </div>
            <button
              onClick={() => callHook?.dismissMissedCall?.()}
              className="w-6 h-6 rounded-full bg-[#FFFFFF]/20 hover:bg-[#FFFFFF]/30 flex items-center justify-center transition-colors"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
          <div className="px-4 py-2.5 text-xs text-[#9B9890]">
            Caller hung up before you could answer
          </div>
        </div>
      </div>
    )
  }

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
          className="flex items-center gap-3 pl-3 pr-4 py-2.5 bg-[#FFFFFF] rounded-full shadow-lg border border-[#E3E1DB] hover:shadow-xl transition-shadow"
        >
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[#D63B1F] flex items-center justify-center text-white text-xs font-semibold">
              {getInitials()}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
              isActive ? 'bg-[#22c55e] animate-pulse' : 'bg-[#f59e0b] animate-pulse'
            }`} />
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-[#131210] leading-tight">{formatPhoneNumber(getPhoneNumber())}</p>
            <p className="text-[10px] text-[#9B9890] leading-tight">{getCallStatusText()}</p>
          </div>
          <div
            className="w-7 h-7 rounded-full bg-[rgba(214,59,31,0.07)] hover:bg-[rgba(214,59,31,0.15)] flex items-center justify-center ml-1 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleEndClick() }}
          >
            <PhoneOff className="w-3.5 h-3.5 text-[#D63B1F]" />
          </div>
        </button>
      </div>
    )
  }

  // Incoming call — compact bottom-left toast (OpenPhone-style)
  if (callStatus === 'incoming') {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-80 animate-slideUp">
        <div className="bg-[#FFFFFF] rounded-2xl shadow-[0_20px_56px_rgba(19,18,16,0.16)] border border-[#E3E1DB] overflow-hidden">
          {/* Header with caller info */}
          <div className="px-5 pt-4 pb-3 flex items-center gap-3.5">
            {/* Pulsing avatar */}
            <div className="relative flex-shrink-0">
              <span className="absolute inset-0 w-12 h-12 rounded-full bg-[#D63B1F]/15 animate-ping" style={{ animationDuration: '1.8s' }} />
              <div className="relative w-12 h-12 rounded-full bg-[#D63B1F] flex items-center justify-center text-white text-sm font-semibold">
                {getInitials()}
              </div>
            </div>

            {/* Caller details */}
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-[#131210] tracking-tight leading-tight truncate">
                {formatPhoneNumber ? formatPhoneNumber(incomingCall?.from) : incomingCall?.from}
              </p>
              <p className="text-[12px] text-[#9B9890] mt-0.5 font-medium">
                Incoming call
                {incomingCall?.to && <span className="text-[#D4D1C9] mx-1">&middot;</span>}
                {incomingCall?.to && (
                  <span>{formatPhoneNumber ? formatPhoneNumber(incomingCall.to) : incomingCall.to}</span>
                )}
              </p>
            </div>

            {/* Close/dismiss */}
            <button
              onClick={onRejectCall}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="px-5 pb-4 flex gap-2.5">
            <button
              onClick={onRejectCall}
              className="flex-1 h-10 bg-[rgba(214,59,31,0.07)] hover:bg-[rgba(214,59,31,0.12)] text-[#D63B1F] rounded-lg flex items-center justify-center gap-2 text-[13px] font-medium transition-colors active:scale-[0.98]"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              onClick={onAcceptCall}
              className="flex-1 h-10 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-lg flex items-center justify-center gap-2 text-[13px] font-medium transition-colors active:scale-[0.98]"
            >
              <Phone className="w-3.5 h-3.5" />
              Accept
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Main Call Card - Bottom Right */}
      <div className="fixed bottom-6 right-6 z-50 w-72">
        <div className="bg-[#FFFFFF] rounded-2xl shadow-2xl border border-[#E3E1DB] overflow-hidden">

          {/* Header */}
          <div className="bg-[#D63B1F] px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#FFFFFF]/20 flex items-center justify-center text-white text-xs font-semibold">
                  {getInitials()}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold leading-tight">{formatPhoneNumber(getPhoneNumber())}</p>
                  <p className="text-white/80 text-xs leading-tight mt-0.5">{getCallStatusText()}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  isActive ? 'bg-[#22c55e]/60 animate-pulse' :
                  isConnecting ? 'bg-[#f59e0b]/60 animate-pulse' :
                  'bg-[#FFFFFF]/40'
                }`} />
                <button
                  onClick={() => setIsMinimized(true)}
                  className="w-6 h-6 rounded-full bg-[#FFFFFF]/15 hover:bg-[#FFFFFF]/25 flex items-center justify-center transition-colors"
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
              <div className="mb-3 p-2.5 bg-[#F7F6F3] rounded-lg">
                <p className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-wider mb-1.5">
                  Conference ({participantCalls.length + 1})
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                      <span className="text-xs text-[#5C5A55] font-medium">You</span>
                    </div>
                    <span className="text-[10px] text-[#16a34a] font-medium">Host</span>
                  </div>
                  {participantCalls.map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          getParticipantStatus(p) === 'Connected' ? 'bg-[#22c55e]' :
                          getParticipantStatus(p) === 'Disconnected' ? 'bg-[#D63B1F]' :
                          'bg-[#f59e0b] animate-pulse'
                        }`} />
                        <span className="text-xs text-[#5C5A55]">{formatPhoneNumber(p.phoneNumber)}</span>
                      </div>
                      <span className={`text-[10px] font-medium ${
                        getParticipantStatus(p) === 'Connected' ? 'text-[#16a34a]' :
                        getParticipantStatus(p) === 'Disconnected' ? 'text-[#D63B1F]' :
                        'text-[#d97706]'
                      }`}>{getParticipantStatus(p)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Message */}
            {conferenceStatus && (
              <div className="mb-3 px-2.5 py-2 bg-[rgba(214,59,31,0.07)] rounded-lg flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D63B1F] animate-pulse shrink-0" />
                <p className="text-xs text-[#D63B1F] font-medium">{conferenceStatus}</p>
              </div>
            )}

            {/* Active Call Controls */}
            {(
              <>
                <div className="flex items-center justify-center gap-3">
                  {/* Mute */}
                  <button
                    onClick={handleMuteClick}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                      isMuted
                        ? 'bg-[#D63B1F]/10 text-[#D63B1F] ring-1 ring-[#D63B1F]/30'
                        : 'bg-[#EFEDE8] text-[#5C5A55] hover:bg-[#EFEDE8]'
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
                        ? 'bg-[rgba(245,158,11,0.07)] text-[#d97706] ring-1 ring-[#f59e0b]/60'
                        : 'bg-[#EFEDE8] text-[#5C5A55] hover:bg-[#EFEDE8]'
                    }`}
                    title={isOnHold ? 'Resume' : 'Hold'}
                  >
                    {isOnHold ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>

                  {/* End Call */}
                  <button
                    onClick={handleEndClick}
                    className="w-12 h-12 bg-[#D63B1F] hover:bg-[#c23119] rounded-full flex items-center justify-center text-white shadow-md transition-all active:scale-95"
                    title="End Call"
                  >
                    <PhoneOff className="w-5 h-5" />
                  </button>

                  {/* Dialpad */}
                  <button
                    onClick={() => { setShowDialpad(!showDialpad); setShowAddParticipant(false); setShowTransfer(false) }}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                      showDialpad
                        ? 'bg-[#D63B1F]/10 text-[#D63B1F] ring-1 ring-[#D63B1F]/30'
                        : 'bg-[#EFEDE8] text-[#5C5A55] hover:bg-[#EFEDE8]'
                    }`}
                    title="Dialpad"
                  >
                    <Grid3X3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Secondary actions */}
                <div className="flex justify-center gap-6 mt-3 pt-3 border-t border-[#E3E1DB]">
                  <button
                    onClick={() => { setShowAddParticipant(true); setShowDialpad(false); setShowTransfer(false) }}
                    disabled={callStatus === 'transferring'}
                    className="flex flex-col items-center gap-0.5 text-[#9B9890] hover:text-[#5C5A55] disabled:opacity-40 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span className="text-[10px] font-medium">Add</span>
                  </button>
                  <button
                    onClick={() => { setShowTransfer(true); setShowDialpad(false); setShowAddParticipant(false) }}
                    disabled={callStatus === 'transferring'}
                    className="flex flex-col items-center gap-0.5 text-[#9B9890] hover:text-[#5C5A55] disabled:opacity-40 transition-colors"
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
          <div className="mt-2 bg-[#FFFFFF] rounded-2xl shadow-2xl border border-[#E3E1DB] overflow-hidden">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider">Dialpad</span>
              <button onClick={() => setShowDialpad(false)} className="w-6 h-6 rounded-full bg-[#EFEDE8] hover:bg-[#EFEDE8] flex items-center justify-center">
                <X className="w-3 h-3 text-[#9B9890]" />
              </button>
            </div>
            {dialpadInput && (
              <div className="px-4 pb-1">
                <div className="bg-[#F7F6F3] rounded-lg px-3 py-1.5 flex items-center justify-between">
                  <span className="text-sm font-mono text-[#131210]">{dialpadInput}</span>
                  <button onClick={() => setDialpadInput('')} className="text-[#9B9890] hover:text-[#5C5A55]">
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
                  className="h-12 bg-[#F7F6F3] hover:bg-[#F7F6F3] active:bg-[#EFEDE8] rounded-xl flex flex-col items-center justify-center transition-all active:scale-95"
                >
                  <span className="text-lg font-semibold text-[#131210] leading-none">{digit}</span>
                  {dialpadLetters[digit] && <span className="text-[8px] text-[#9B9890] leading-none mt-0.5">{dialpadLetters[digit]}</span>}
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
            actionColor="[#D63B1F]"
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
            actionColor="[#22c55e]"
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
    <div className="mt-2 bg-[#FFFFFF] rounded-2xl shadow-2xl border border-[#E3E1DB] overflow-hidden max-h-72">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#9B9890] uppercase tracking-wider">{title}</span>
        <button onClick={onClose} className="w-6 h-6 rounded-full bg-[#EFEDE8] hover:bg-[#EFEDE8] flex items-center justify-center">
          <X className="w-3 h-3 text-[#9B9890]" />
        </button>
      </div>
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#9B9890] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Name or phone number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-[#E3E1DB] rounded-lg focus:outline-none focus:border-[#D63B1F]/40 focus:ring-1 focus:ring-[#D63B1F]/20"
          />
        </div>
      </div>
      <div className="max-h-44 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="w-5 h-5 text-[#9B9890] animate-spin" />
          </div>
        ) : contacts.length > 0 ? (
          contacts.map((c) => (
            <button key={c.id} onClick={() => onSelect(c.phone_number)} className="w-full flex items-center gap-2.5 px-2 py-2 hover:bg-[#F7F6F3] rounded-lg text-left transition-colors">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                isTransfer ? 'bg-[rgba(34,197,94,0.07)] text-[#16a34a]' : 'bg-[#D63B1F]/10 text-[#D63B1F]'
              }`}>
                {isTransfer ? <ArrowRightLeft className="w-3 h-3" /> : <User className="w-3 h-3" />}
              </div>
              <div>
                <p className="text-xs font-medium text-[#131210]">{c.name || 'Unknown'}</p>
                <p className="text-[10px] text-[#9B9890]">{formatPhoneNumber(c.phone_number)}</p>
              </div>
            </button>
          ))
        ) : searchQuery ? (
          <div className="py-4 text-center">
            <button
              onClick={() => onSelect(searchQuery)}
              className={`px-4 py-2 text-white text-xs font-medium rounded-lg transition-colors ${
                isTransfer ? 'bg-[#22c55e] hover:bg-[#16a34a]' : 'bg-[#D63B1F] hover:bg-[#c23119]'
              }`}
            >
              {isTransfer ? 'Transfer to' : 'Call'} {searchQuery}
            </button>
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-[#9B9890]">Enter a number above</div>
        )}
      </div>
    </div>
  )
}
