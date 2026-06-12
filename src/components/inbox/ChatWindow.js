// components/inbox/ChatWindow.js - Modern SaaS redesign with mobile optimization
'use client'

import { useState, useRef, useEffect } from 'react'
import MessageBubble from '../ui/message-bubble'
import CallBubble from '../ui/call-bubble'
import CallInterface from '../calling/CallInterface'
import ScheduleModal from './ScheduleModal'
import { apiPost, apiGet, apiDelete, fetchWithWorkspace } from '@/lib/api-client'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

// Small curated emoji set for the composer picker (no heavy dependency).
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','🙌','👍','👎','👏','🙏','💪','🔥','✨','🎉','✅','❌','⚠️','💯','❤️','🧡','💛','💚','💙','💜','🤝','📞','📱','💬','📩','⏰','📅','💰','🏠','🚗','👋','🤔','😅','😉','🙂','😇','🥹','😢','😡']

export default function ChatWindow({
  conversation,
  messages,
  phoneNumber,
  formatPhoneNumber,
  addOptimisticMessage,
  replaceOptimisticMessage,
  removeOptimisticMessage,
  onRefreshConversations,
  user,
  // Call-related props
  callHook,
  // Mobile props
  onBackToList,
  // Action handlers
  onMarkAsRead,
  onMarkAsUnread,
  onMarkAsDone,
  onMarkAsOpen,
  onPinConversation,
  onBlockContact,
  onDeleteConversation,
  onAssignScenario
}) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  // MMS attachments staged for the next send: [{ file, previewUrl, type }]
  const [attachments, setAttachments] = useState([])
  const [showEmoji, setShowEmoji] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduled, setScheduled] = useState([])   // pending scheduled messages for this conversation
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const moreMenuRef = useRef(null)
  const fileInputRef = useRef(null)
  const emojiRef = useRef(null)

  // ── Voice message recording (WhatsApp-style) ──
  const [isRecording, setIsRecording] = useState(false)
  const [recordElapsed, setRecordElapsed] = useState(0)   // seconds
  const [recordError, setRecordError] = useState('')
  const mediaRecorderRef = useRef(null)
  const recordChunksRef = useRef([])
  const recordStreamRef = useRef(null)
  const recordTimerRef = useRef(null)
  const recordIntentRef = useRef('cancel')   // 'send' | 'cancel' — read in onstop
  const recordMimeRef = useRef('audio/webm')

  // Close more menu when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false)
      }
      if (emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmoji(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Load pending scheduled messages for this conversation.
  const loadScheduled = async () => {
    if (!conversation?.id) { setScheduled([]); return }
    try {
      const res = await apiGet(`/api/sms/schedule?conversationId=${conversation.id}`)
      const data = await res.json()
      setScheduled(data?.scheduled || [])
    } catch { setScheduled([]) }
  }
  // Reload on conversation switch AND whenever the message list changes — when a
  // scheduled message is sent, a new message appears, so this drops its card in
  // sync. A slow poll is the backstop if the thread isn't actively refreshing.
  useEffect(() => { loadScheduled() }, [conversation?.id, messages?.length])
  useEffect(() => {
    if (!conversation?.id) return
    const id = setInterval(() => loadScheduled(), 30000)
    return () => clearInterval(id)
  }, [conversation?.id])

  const cancelScheduled = async (id) => {
    try {
      await apiDelete(`/api/sms/schedule?id=${id}`)
      setScheduled(prev => prev.filter(s => s.id !== id))
    } catch (e) { console.error('Cancel scheduled failed:', e) }
  }

  const formatScheduled = (iso, tz) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
    } catch { return new Date(iso).toLocaleString() }
  }

  // Focus input and reset textarea height when conversation changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = '44px'
    }
  }, [conversation])

  // Auto-select the correct caller number when conversation changes
  useEffect(() => {
    if (conversation && callHook) {
      const correctNumber = findMatchingCallerNumber()
      if (correctNumber && correctNumber !== callHook.selectedCallerNumber) {
        callHook.setSelectedCallerNumber(correctNumber)
      }
    }
  }, [conversation?.id])

  // Helper function to find the correct caller number
  const findMatchingCallerNumber = () => {
    // Priority 1: Use the conversation's own line (from_number is our number for this convo)
    if (conversation?.from_number) {
      return conversation.from_number
    }

    // Priority 2: Use the currently selected phone line from sidebar
    if (phoneNumber?.phoneNumber) {
      return phoneNumber.phoneNumber
    }

    // Priority 3: Try from messages
    const msgItems = messages.filter(m => m._type !== 'call')
    if (msgItems.length > 0) {
      const sorted = [...msgItems].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const outbound = sorted.find(m => m.direction === 'outbound')
      if (outbound?.from_number) return outbound.from_number
      const inbound = sorted.find(m => m.direction === 'inbound')
      if (inbound?.to_number) return inbound.to_number
    }

    // Fallback
    return callHook?.selectedCallerNumber || callHook?.availablePhoneNumbers?.[0]?.phoneNumber
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const sendMessage = async (e) => {
    e?.preventDefault?.()

    const messageText = newMessage.trim()
    const hasMedia = attachments.length > 0
    if ((!messageText && !hasMedia) || sending || !phoneNumber) return

    setSending(true)
    setShowEmoji(false)
    const staged = attachments
    setNewMessage('')
    setAttachments([])

    // Upload any staged attachments → public URLs (for Telnyx MMS + our bubble).
    let media = []
    try {
      media = await Promise.all(staged.map(async (a) => {
        const fd = new FormData()
        fd.append('file', a.file)
        const res = await fetchWithWorkspace('/api/messages/upload-media', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed')
        return { url: data.url, type: data.type }
      }))
    } catch (err) {
      console.error('Attachment upload failed:', err)
      setSending(false)
      setNewMessage(messageText)
      setAttachments(staged)
      return
    }

    const optimisticId = addOptimisticMessage({
      conversation_id: conversation.id,
      direction: 'outbound',
      from_number: phoneNumber.phoneNumber,
      to_number: conversation.phone_number,
      body: messageText,
      media_urls: media.length ? media : null,
      status: 'sending',
      sent_by: user.userId
    })

    try {
      const response = await apiPost('/api/sms/send', {
        from: phoneNumber.phoneNumber,
        to: conversation.phone_number,
        message: messageText,
        mediaUrls: media,
        conversationId: conversation.id,
        userId: user.userId,
        agentReply: true,   // a human is replying → auto-pause the AI for this chat
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to send message')
      }

      if (result.message) {
        replaceOptimisticMessage(optimisticId, result.message)
      }
      // Reflect the auto-pause in the panel immediately.
      if (result.aiPaused) onRefreshConversations?.()

      onRefreshConversations()

    } catch (error) {
      console.error('Error sending message:', error)
      removeOptimisticMessage(optimisticId)
      setNewMessage(messageText)
      setAttachments(staged)
    } finally {
      setSending(false)
    }
  }

  // Stage image/video files chosen via the paperclip button.
  const handleFilesSelected = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''   // let the same file be re-selected later
    const next = files
      .filter(f => /^(image|video)\//.test(f.type))
      .map(f => ({ file: f, type: f.type, previewUrl: URL.createObjectURL(f) }))
    if (next.length) setAttachments(prev => [...prev, ...next].slice(0, 10))
  }

  const removeAttachment = (idx) => {
    setAttachments(prev => {
      const a = prev[idx]
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const insertEmoji = (emoji) => {
    setNewMessage(prev => prev + emoji)
    textareaRef.current?.focus()
  }

  // ── Voice messages ──
  const fmtElapsed = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  // Pick the best MediaRecorder mime the browser supports.
  const pickAudioMime = () => {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']
    if (typeof MediaRecorder === 'undefined') return ''
    for (const c of cands) { if (MediaRecorder.isTypeSupported(c)) return c }
    return ''
  }

  const startRecording = async () => {
    if (isRecording || sending || !phoneNumber) return
    setRecordError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordError('Voice recording isn’t supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordStreamRef.current = stream
      const mime = pickAudioMime()
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recordMimeRef.current = (mr.mimeType || mime || 'audio/webm').split(';')[0]
      recordChunksRef.current = []
      recordIntentRef.current = 'cancel'

      mr.ondataavailable = (e) => { if (e.data && e.data.size) recordChunksRef.current.push(e.data) }
      mr.onstop = () => {
        (recordStreamRef.current?.getTracks() || []).forEach(t => t.stop())
        recordStreamRef.current = null
        clearInterval(recordTimerRef.current)
        const chunks = recordChunksRef.current
        recordChunksRef.current = []
        setIsRecording(false)
        setRecordElapsed(0)
        if (recordIntentRef.current === 'send' && chunks.length) {
          const type = recordMimeRef.current || 'audio/webm'
          const blob = new Blob(chunks, { type })
          if (blob.size > 0) sendVoiceNote(blob, type)
        }
      }

      mediaRecorderRef.current = mr
      mr.start()
      setIsRecording(true)
      setRecordElapsed(0)
      recordTimerRef.current = setInterval(() => setRecordElapsed(s => s + 1), 1000)
    } catch (err) {
      console.error('Mic access failed:', err)
      setRecordError('Microphone access was blocked. Allow mic access and try again.')
    }
  }

  // intent: 'send' to upload+send the clip, 'cancel' to discard it.
  const stopRecording = (intent) => {
    recordIntentRef.current = intent
    try { mediaRecorderRef.current?.stop() } catch { /* already stopped */ }
  }

  // Upload the recorded clip and send it as an MMS voice message.
  const sendVoiceNote = async (blob, type) => {
    if (!phoneNumber || !conversation) return
    setSending(true)
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
    const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type })

    let media
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetchWithWorkspace('/api/messages/upload-media', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed')
      media = [{ url: data.url, type: data.type }]
    } catch (err) {
      console.error('Voice note upload failed:', err)
      setRecordError('Could not upload the voice message.')
      setSending(false)
      return
    }

    const optimisticId = addOptimisticMessage({
      conversation_id: conversation.id,
      direction: 'outbound',
      from_number: phoneNumber.phoneNumber,
      to_number: conversation.phone_number,
      body: '',
      media_urls: media,
      status: 'sending',
      sent_by: user.userId,
    })

    try {
      const response = await apiPost('/api/sms/send', {
        from: phoneNumber.phoneNumber,
        to: conversation.phone_number,
        message: '',
        mediaUrls: media,
        conversationId: conversation.id,
        userId: user.userId,
        agentReply: true,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || result.message || 'Failed to send voice message')
      if (result.message) replaceOptimisticMessage(optimisticId, result.message)
      if (result.aiPaused) onRefreshConversations?.()
      onRefreshConversations()
    } catch (error) {
      console.error('Error sending voice note:', error)
      removeOptimisticMessage(optimisticId)
      setRecordError('Could not send the voice message.')
    } finally {
      setSending(false)
    }
  }

  // Release mic + timer if the component unmounts mid-recording.
  useEffect(() => () => {
    clearInterval(recordTimerRef.current)
    ;(recordStreamRef.current?.getTracks?.() || []).forEach(t => t.stop())
  }, [])

  // Schedule the current composer contents for later instead of sending now.
  const handleSchedule = async (scheduledAt, timezone, condition) => {
    const messageText = newMessage.trim()
    const staged = attachments
    if ((!messageText && staged.length === 0) || !phoneNumber) return
    setSending(true)
    try {
      let media = []
      if (staged.length) {
        media = await Promise.all(staged.map(async (a) => {
          const fd = new FormData()
          fd.append('file', a.file)
          const res = await fetchWithWorkspace('/api/messages/upload-media', { method: 'POST', body: fd })
          const data = await res.json()
          if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed')
          return { url: data.url, type: data.type }
        }))
      }
      const res = await apiPost('/api/sms/schedule', {
        from: phoneNumber.phoneNumber,
        to: conversation.phone_number,
        message: messageText,
        mediaUrls: media,
        conversationId: conversation.id,
        scheduledAt, timezone, condition,
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to schedule')
      setNewMessage('')
      setAttachments([])
      setShowSchedule(false)
      loadScheduled()
      onRefreshConversations?.()
    } catch (e) {
      console.error('Schedule failed:', e)
      alert(e.message || 'Failed to schedule message')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    // Send message on Enter (mobile: also allow without Shift), allow new line with Shift+Enter (desktop)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(e)
    }
  }

  const handleTextareaInput = (e) => {
    // Auto-resize textarea
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 44), 120)}px`
  }

  const handleCallClick = async () => {
    // Check WebRTC readiness first with helpful messages
    if (callHook.isInitializing) {
      alert('Phone system is still connecting. Please wait a few seconds and try again.')
      return
    }

    if (callHook.initError) {
      alert(`Phone system error: ${callHook.initError}`)
      return
    }

    if (!callHook.isRegistered) {
      alert('Phone system is not connected. Please refresh the page and try again.')
      return
    }

    // Auto-select the correct caller number before making the call
    const correctCallerNumber = findMatchingCallerNumber()

    if (!correctCallerNumber) {
      alert('No suitable phone number found for calling')
      return
    }

    if (callHook.isCallActive) {
      alert('A call is already in progress')
      return
    }

    try {
      console.log(`Initiating call to ${conversation.phone_number} from ${correctCallerNumber}`)
      await callHook.initiateCall(conversation.phone_number, correctCallerNumber, conversation.id)
    } catch (error) {
      console.error('Error initiating call:', error)
      alert(error.message || 'Failed to initiate call')
    }
  }

  const displayName = (conversation.contact_first_name || conversation.contact_last_name)
    ? [conversation.contact_first_name, conversation.contact_last_name].filter(Boolean).join(' ')
    : (conversation.name || formatPhoneNumber(conversation.phone_number))
  const initials = getInitials(displayName, conversation.phone_number)
  const isOnCall = callHook?.getCurrentCallNumber && callHook.getCurrentCallNumber() === conversation.phone_number
  const isWebRTCReady = callHook?.isRegistered && !callHook?.isInitializing

  return (
    <div className="flex flex-1 min-h-0 bg-[#FFFFFF]">
      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 relative">
        {/* Header */}
        <div className="bg-[#FFFFFF] border-b border-[#E3E1DB] sticky top-0 z-10">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              {/* Left: Back button (mobile) + Avatar + Info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Mobile Back Button */}
                {onBackToList && (
                  <button
                    onClick={onBackToList}
                    className="md:hidden p-2 -ml-2 text-[#5C5A55] hover:text-[#131210]"
                    aria-label="Back to conversations"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: getAvatarColor(conversation.phone_number) }}
                  >
                    {initials}
                  </div>
                </div>

                {/* Contact Info */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-[#131210] truncate">
                    {displayName}
                  </h2>
                  <p className="text-sm text-[#5C5A55] truncate">
                    {conversation.phone_number}
                  </p>
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Call */}
                <button
                  onClick={handleCallClick}
                  disabled={(callHook?.isCallActive && !isOnCall) || !isWebRTCReady}
                  className={`relative p-2 rounded-lg transition-colors disabled:opacity-40 ${
                    isWebRTCReady
                      ? 'text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3]'
                      : 'text-[#D4D1C9] cursor-not-allowed'
                  }`}
                  title={
                    callHook?.isInitializing ? 'Connecting phone system...' :
                    callHook?.initError ? `Phone error: ${callHook.initError}` :
                    !callHook?.isRegistered ? 'Phone system not connected' :
                    'Call'
                  }
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
                  </svg>
                </button>

                {/* Done / Open toggle — hidden on mobile, in more menu instead */}
                <button
                  onClick={() => {
                    if (conversation.status === 'closed') {
                      onMarkAsOpen?.(conversation.id)
                    } else {
                      onMarkAsDone?.(conversation.id)
                    }
                  }}
                  className="hidden md:flex p-2 text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] rounded-lg transition-colors"
                  title={conversation.status === 'closed' ? 'Mark as open' : 'Mark as done'}
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>

                {/* Mark as unread — hidden on mobile */}
                <button
                  onClick={() => onMarkAsUnread?.(conversation.id)}
                  className="hidden md:flex p-2 text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] rounded-lg transition-colors"
                  title="Mark as unread"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8.33333333,1.875 C8.6785113,1.875 8.95833333,2.15482203 8.95833333,2.5 C8.95833333,2.81379815 8.72707546,3.07358314 8.42569125,3.1182234 L8.33333333,3.125 L4.99999978,3.125 C4.01378052,3.125 3.20539387,3.88642392 3.13064099,4.85347034 L3.12499978,5 L3.12499978,15 C3.12499978,15.9862194 3.88642349,16.7946059 4.85347009,16.8693588 L4.99999978,16.875 L14.9999998,16.875 C15.9862192,16.875 16.7946057,16.1135763 16.8693586,15.1465297 L16.8749998,15 L16.8749998,11.6666667 C16.8749998,11.3214887 17.1548218,11.0416667 17.4999998,11.0416667 C17.8137979,11.0416667 18.0735829,11.2729245 18.1182232,11.5743087 L18.1249998,11.6666667 L18.1249998,15 C18.1249998,16.666373 16.8207131,18.0281208 15.1773301,18.1200531 L14.9999998,18.125 L4.99999978,18.125 C3.3336268,18.125 1.97187893,16.8207133 1.87994671,15.1773303 L1.87499978,15 L1.87499978,5 C1.87499978,3.33362727 3.17928662,1.97187917 4.82266946,1.87994693 L4.99999978,1.875 L8.33333333,1.875 Z M14.375,1.875 C16.4460678,1.875 18.125,3.55393219 18.125,5.625 C18.125,7.69606781 16.4460678,9.375 14.375,9.375 C12.3039322,9.375 10.625,7.69606781 10.625,5.625 C10.625,3.55393219 12.3039322,1.875 14.375,1.875 Z M14.375,3.125 C12.9942881,3.125 11.875,4.24428813 11.875,5.625 C11.875,7.00571187 12.9942881,8.125 14.375,8.125 C15.7557119,8.125 16.875,7.00571187 16.875,5.625 C16.875,4.24428813 15.7557119,3.125 14.375,3.125 Z" />
                  </svg>
                </button>

                {/* More (three dots) */}
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={() => setShowMoreMenu(v => !v)}
                    className="p-2 text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] rounded-lg transition-colors"
                    title="More options"
                  >
                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>

                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-[#FFFFFF] rounded-lg shadow-lg border border-[#E3E1DB] py-1 z-50">
                      {onAssignScenario && (
                        <button
                          onClick={() => { onAssignScenario(conversation.id, conversation.phone_number); setShowMoreMenu(false) }}
                          className="w-full px-4 py-2.5 text-left text-sm text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center gap-3"
                        >
                          <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2"/>
                            <path d="M8 21h8M12 17v4"/>
                          </svg>
                          Assign scenario
                        </button>
                      )}
                      <button
                        onClick={() => { onPinConversation?.(conversation.id); setShowMoreMenu(false) }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center gap-3"
                      >
                        <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                        </svg>
                        {conversation.pinned ? 'Unpin' : 'Pin'} conversation
                      </button>
                      <button
                        onClick={() => { onBlockContact?.(conversation.id, conversation.phone_number); setShowMoreMenu(false) }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center gap-3"
                      >
                        <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M4.93 4.93l14.14 14.14"/>
                        </svg>
                        Block contact
                      </button>
                      <div className="my-1 border-t border-[#E3E1DB]" />
                      <button
                        onClick={() => { onDeleteConversation?.(conversation.id); setShowMoreMenu(false) }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                        Delete conversation
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Messages Area - Instant like OpenPhone, NO loading or empty state */}
        <div className="flex-1 overflow-y-auto bg-[#FFFFFF]">
          <div className="p-4 space-y-2">
            {messages.map((item) => (
              item._type === 'call'
                ? <CallBubble key={`call-${item.id}`} call={item} />
                : <MessageBubble key={item.id} message={item} user={user} />
            ))}

            {/* Pending scheduled messages — shown at the bottom (they're future). */}
            {scheduled.map((s) => (
              <div key={`sched-${s.id}`} className="flex justify-end group">
                <div className="max-w-[85%] sm:max-w-md">
                  <div className="px-3.5 py-2.5 rounded-2xl bg-white border-2 border-dashed border-[#D63B1F]/45 text-[#131210]">
                    {Array.isArray(s.media_urls) && s.media_urls.length > 0 && (
                      <div className="mb-1.5 space-y-1.5">
                        {s.media_urls.map((m, i) => (m.type || '').startsWith('video')
                          ? <video key={i} src={m.url} className="rounded-lg w-full" style={{ maxHeight: 200 }} />
                          : <img key={i} src={m.url} alt="" className="rounded-lg w-full object-cover" style={{ maxHeight: 200 }} />)}
                      </div>
                    )}
                    {s.body && <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.body}</p>}
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-1 px-1 text-[11px] text-[#9B9890]">
                    <svg className="w-3 h-3 text-[#D63B1F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                    <span className="font-medium text-[#D63B1F]">Scheduled for {formatScheduled(s.scheduled_at, s.timezone)}</span>
                    {s.condition === 'unless_first' && <span className="text-[#9B9890]">· unless they reply</span>}
                    <button onClick={() => cancelScheduled(s.id)} className="text-[#9B9890] hover:text-[#D63B1F] underline">Cancel</button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-[#FFFFFF] border-t border-[#E3E1DB] sticky bottom-0 z-10">
          <div className="px-3 py-3 md:px-4 md:py-4">
            {/* Staged attachment previews */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((a, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#E3E1DB] bg-[#F7F6F3]">
                    {a.type?.startsWith('video') ? (
                      <video src={a.previewUrl} className="w-full h-full object-cover" />
                    ) : (
                      <img src={a.previewUrl} alt="" className="w-full h-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                      aria-label="Remove attachment"
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {recordError && (
              <p className="mb-2 text-xs text-[#D63B1F]">{recordError}</p>
            )}

            <form onSubmit={sendMessage} className="flex items-end gap-2">
              {/* Hidden file input + attach (paperclip) button */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />

              {isRecording ? (
                <>
                  <button
                    type="button"
                    onClick={() => stopRecording('cancel')}
                    title="Cancel recording"
                    className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full md:rounded-lg text-[#D63B1F] hover:bg-[rgba(214,59,31,0.08)] transition-colors"
                    aria-label="Cancel voice message"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                  </button>
                  <div className="flex-1 flex items-center gap-2.5 h-11 px-3.5 rounded-2xl md:rounded-lg border border-[#D4D1C9] bg-[#F7F6F3]">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D63B1F] animate-pulse shrink-0" />
                    <span className="text-sm font-mono tabular-nums text-[#131210]">{fmtElapsed(recordElapsed)}</span>
                    <span className="text-xs text-[#9B9890] truncate">Recording voice message…</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => stopRecording('send')}
                    title="Send voice message"
                    className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[#D63B1F] text-white hover:bg-[#c23119] transition-colors"
                    aria-label="Send voice message"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                  </button>
                </>
              ) : (
                <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || !phoneNumber}
                title="Attach photo or video"
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full md:rounded-lg text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] disabled:opacity-40 transition-colors"
                aria-label="Attach media"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                </svg>
              </button>

              {/* Emoji button + popover */}
              <div className="relative shrink-0" ref={emojiRef}>
                <button
                  type="button"
                  onClick={() => setShowEmoji(s => !s)}
                  disabled={sending || !phoneNumber}
                  title="Emoji"
                  className="w-10 h-10 flex items-center justify-center rounded-full md:rounded-lg text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] disabled:opacity-40 transition-colors"
                  aria-label="Insert emoji"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M9 10h.01M15 10h.01M8.5 14.5a4 4 0 007 0" />
                  </svg>
                </button>
                {showEmoji && (
                  <div className="absolute bottom-12 left-0 w-64 max-h-52 overflow-y-auto bg-white border border-[#E3E1DB] rounded-xl shadow-xl p-2 grid grid-cols-8 gap-1 z-20">
                    {EMOJIS.map((emo) => (
                      <button
                        key={emo}
                        type="button"
                        onClick={() => insertEmoji(emo)}
                        className="text-lg leading-none p-1 rounded hover:bg-[#F7F6F3]"
                      >
                        {emo}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                rows={1}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onClick={() => onMarkAsRead?.(conversation.id)}
                onKeyDown={handleKeyDown}
                onInput={handleTextareaInput}
                placeholder="Type a message..."
                disabled={sending || !phoneNumber}
                className="flex-1 px-3.5 py-2.5 border border-[#D4D1C9] rounded-2xl md:rounded-lg resize-none focus:outline-none focus:border-[#D4D1C9] text-sm bg-[#F7F6F3] md:bg-white"
                style={{
                  height: 'auto',
                  minHeight: '44px',
                  maxHeight: '120px',
                }}
              />

              {/* Schedule (send later) */}
              <button
                type="button"
                onClick={() => setShowSchedule(true)}
                disabled={(!newMessage.trim() && attachments.length === 0) || sending || !phoneNumber}
                title="Schedule for later"
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full md:rounded-lg text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] disabled:opacity-40 transition-colors"
                aria-label="Schedule message"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                </svg>
              </button>

              {(newMessage.trim() || attachments.length > 0) ? (
                <button
                  type="submit"
                  disabled={sending || !phoneNumber}
                  className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[#D63B1F] text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-[#c23119] md:w-auto md:h-auto md:rounded-lg md:p-2 md:bg-transparent md:text-[#5C5A55] md:hover:text-[#131210] md:hover:bg-[#F7F6F3]"
                  aria-label="Send message"
                >
                  {sending ? (
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin md:border-[#D4D1C9] md:border-t-[#5C5A55]"></div>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={sending || !phoneNumber}
                  title="Record voice message"
                  className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[#D63B1F] text-white hover:bg-[#c23119] disabled:opacity-40 transition-colors md:w-auto md:h-auto md:rounded-lg md:p-2 md:bg-transparent md:text-[#5C5A55] md:hover:text-[#131210] md:hover:bg-[#F7F6F3]"
                  aria-label="Record voice message"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </button>
              )}
                </>
              )}
            </form>
          </div>
        </div>

        <ScheduleModal
          open={showSchedule}
          onClose={() => setShowSchedule(false)}
          onSchedule={handleSchedule}
        />
      </div>

      {/* Call Interface - Floating overlay */}
      {callHook && (
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
          callHook={callHook}
        />
      )}

      {/* Custom Animations */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        /* Smooth scrollbar styling */
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }

        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #D4D1C9;
          border-radius: 3px;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #9B9890;
        }

        /* Input focus ring animation */
        textarea:focus {
          outline: none;
        }

        /* Disable resize handle on mobile */
        @media (max-width: 640px) {
          textarea {
            resize: none !important;
          }
        }
      `}</style>
    </div>
  )
}