'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { apiGet } from '@/lib/api-client'

function normalizePhoneNumber(phone) {
  if (!phone) return phone
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('1') && digits.length === 11) {
    return `+${digits}`
  } else if (digits.length === 10) {
    return `+1${digits}`
  }
  return phone.startsWith('+') ? phone : `+1${digits}`
}

// Cache for messages - stores messages by conversation ID
const messageCache = new Map()
const callCache = new Map()

export function useRealtimeMessages(conversationId) {
  const [messages, setMessages] = useState([])
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(false)
  const [optimisticMessages, setOptimisticMessages] = useState([])
  const channelRef = useRef(null)
  const callChannelRef = useRef(null)
  const messageIdsRef = useRef(new Set())
  const callIdsRef = useRef(new Set())
  const currentConversationIdRef = useRef(conversationId)

  // Immediately update messages when conversationId changes - BEFORE any async operations
  useEffect(() => {
    if (conversationId !== currentConversationIdRef.current) {
      currentConversationIdRef.current = conversationId

      if (!conversationId) {
        setMessages([])
        setCalls([])
        return
      }

      // INSTANT synchronous cache check - no delay at all
      const cached = messageCache.get(conversationId)
      if (cached) {
        setMessages(cached) // Instant update
        messageIdsRef.current.clear()
        cached.forEach(msg => messageIdsRef.current.add(msg.id))
      } else {
        setMessages([]) // Show empty immediately
      }

      const cachedCalls = callCache.get(conversationId)
      if (cachedCalls) {
        setCalls(cachedCalls)
        callIdsRef.current.clear()
        cachedCalls.forEach(c => callIdsRef.current.add(c.id))
      } else {
        setCalls([])
      }
    }
  }, [conversationId])

  const fetchCalls = useCallback(async () => {
    if (!conversationId) {
      setCalls([])
      return
    }

    try {
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) throw error

      if (currentConversationIdRef.current === conversationId) {
        callIdsRef.current.clear()
        data?.forEach(c => callIdsRef.current.add(c.id))
        callCache.set(conversationId, data || [])
        setCalls(data || [])
      }
    } catch (error) {
      console.error('Error fetching calls:', error)
    }
  }, [conversationId])

  const fetchMessages = useCallback(async () => {
    if (!conversationId) {
      setMessages([])
      return
    }

    // Check cache first - INSTANT load like WhatsApp (synchronous)
    const cached = messageCache.get(conversationId)
    if (cached) {
      // Background fetch to update cache (don't await)
      supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .then(({ data, error }) => {
          if (!error && data && currentConversationIdRef.current === conversationId) {
            messageIdsRef.current.clear()
            data.forEach(msg => messageIdsRef.current.add(msg.id))
            messageCache.set(conversationId, data)
            setMessages(data)
          }
        })
        .catch(error => console.error('Error updating messages:', error))

      return // Exit immediately after setting cache
    }

    // First load - fetch from server
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) throw error

      if (currentConversationIdRef.current === conversationId) {
        messageIdsRef.current.clear()
        data?.forEach(msg => messageIdsRef.current.add(msg.id))

        // Update cache and state
        messageCache.set(conversationId, data || [])
        setMessages(data || [])
      }
    } catch (error) {
      console.error('Error fetching messages:', error)
      if (currentConversationIdRef.current === conversationId) {
        setMessages([])
      }
    }
  }, [conversationId])

  useEffect(() => {
    fetchMessages()
    fetchCalls()

    if (!conversationId) return

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }
    if (callChannelRef.current) {
      supabase.removeChannel(callChannelRef.current)
    }

    channelRef.current = supabase
      .channel(`messages_${conversationId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          if (messageIdsRef.current.has(payload.new.id)) return

          messageIdsRef.current.add(payload.new.id)
          setMessages(current => {
            const newMessages = [...current, payload.new]
            const sorted = newMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            // Update cache immediately
            messageCache.set(conversationId, sorted)
            return sorted
          })

          setOptimisticMessages(current =>
            current.filter(msg =>
              !(msg.isOptimistic && msg.body === payload.new.body && msg.direction === payload.new.direction)
            )
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          setMessages(current => {
            const updated = current.map(msg =>
              msg.id === payload.new.id ? payload.new : msg
            )
            // Update cache
            messageCache.set(conversationId, updated)
            return updated
          })
        }
      )
      .subscribe()

    // Subscribe to call changes for this conversation
    callChannelRef.current = supabase
      .channel(`calls_${conversationId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          if (callIdsRef.current.has(payload.new.id)) return
          callIdsRef.current.add(payload.new.id)
          setCalls(current => {
            const updated = [...current, payload.new].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            callCache.set(conversationId, updated)
            return updated
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          setCalls(current => {
            const updated = current.map(c => c.id === payload.new.id ? payload.new : c)
            callCache.set(conversationId, updated)
            return updated
          })
        }
      )
      .subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (callChannelRef.current) {
        supabase.removeChannel(callChannelRef.current)
        callChannelRef.current = null
      }
    }
  }, [conversationId, fetchMessages, fetchCalls])

  const addOptimisticMessage = useCallback((message) => {
    const optimisticId = `optimistic_${Date.now()}_${Math.random()}`
    const optimisticMessage = {
      ...message,
      id: optimisticId,
      isOptimistic: true,
      created_at: new Date().toISOString()
    }
    
    setOptimisticMessages(current => [...current, optimisticMessage])
    return optimisticId
  }, [])

  const replaceOptimisticMessage = useCallback((optimisticId, realMessage) => {
    setOptimisticMessages(current =>
      current.filter(msg => msg.id !== optimisticId)
    )

    // Add ID synchronously BEFORE setMessages so the realtime INSERT handler
    // sees it immediately and won't add a duplicate when the DB event fires
    if (messageIdsRef.current.has(realMessage.id)) return
    messageIdsRef.current.add(realMessage.id)

    setMessages(current => {
      const exists = current.some(msg => msg.id === realMessage.id)
      if (!exists) {
        const updatedMessages = [...current, realMessage]
        return updatedMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      }
      return current
    })
  }, [])

  const removeOptimisticMessage = useCallback((optimisticId) => {
    setOptimisticMessages(current => 
      current.filter(msg => msg.id !== optimisticId)
    )
  }, [])

  // Merge messages and calls into a single timeline
  const allItems = useMemo(() => {
    const msgItems = [...messages, ...optimisticMessages].map(m => ({ ...m, _type: 'message' }))
    const callItems = calls.map(c => ({ ...c, _type: 'call' }))
    return [...msgItems, ...callItems].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    )
  }, [messages, optimisticMessages, calls])

  return {
    messages: allItems,
    loading,
    addOptimisticMessage,
    replaceOptimisticMessage,
    removeOptimisticMessage,
    refetch: () => { fetchMessages(); fetchCalls() }
  }
}

export function usePhoneNumbers(workspaceId) {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)
  const syncedRef = useRef(false)
  const pollIntervalRef = useRef(null)

  const syncCampaignStatus = useCallback((currentNumbers, wid) => {
    // Sync if any US number is pending or null (not yet assigned)
    const needsSync = currentNumbers.some(
      p => p.phoneNumber?.startsWith('+1') && (p.campaign_status === 'pending' || p.campaign_status === null)
    )
    if (!needsSync || !wid) return
    fetch('/api/telnyx/sync-campaign-status', {
      method: 'POST',
      headers: { 'x-workspace-id': wid },
    })
      .then(r => r.json())
      .then(result => {
        if (result.synced > 0) {
          apiGet('/api/phone-numbers')
            .then(r => r.json())
            .then(d => { if (d.success) setPhoneNumbers(d.phoneNumbers || []) })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const fetchAndSubscribe = async () => {
      try {
        const response = await apiGet('/api/phone-numbers')
        const data = await response.json()
        if (data.success) {
          const numbers = data.phoneNumbers || []
          setPhoneNumbers(numbers)

          // Initial sync
          if (!syncedRef.current) {
            syncedRef.current = true
            syncCampaignStatus(numbers, workspaceId)
          }

          // Poll every 30s while any number is pending or unassigned
          const hasPendingOrNull = numbers.some(
            p => p.phoneNumber?.startsWith('+1') && (p.campaign_status === 'pending' || p.campaign_status === null)
          )
          if (hasPendingOrNull && workspaceId) {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = setInterval(() => {
              setPhoneNumbers(current => {
                const stillPending = current.some(
                  p => p.phoneNumber?.startsWith('+1') && (p.campaign_status === 'pending' || p.campaign_status === null)
                )
                if (!stillPending) {
                  clearInterval(pollIntervalRef.current)
                  pollIntervalRef.current = null
                  return current
                }
                syncCampaignStatus(current, workspaceId)
                return current
              })
            }, 30000)
          }
        }
      } catch (e) {
        console.error('Error fetching phone numbers:', e)
      } finally {
        setLoading(false)
      }
    }

    fetchAndSubscribe()

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [workspaceId, syncCampaignStatus])

  useEffect(() => {
    if (!workspaceId) return

    if (channelRef.current) supabase.removeChannel(channelRef.current)

    channelRef.current = supabase
      .channel(`phone_numbers_${workspaceId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'phone_numbers', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          setPhoneNumbers(current => current.map(p =>
            p.id === payload.new.id
              ? { ...p, campaign_status: payload.new.campaign_status, status: payload.new.status, messaging_profile_id: payload.new.messaging_profile_id }
              : p
          ))
        }
      )
      .subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [workspaceId])

  return { phoneNumbers, setPhoneNumbers, loading }
}


export function useRealtimeConversations(fromNumber) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)
  const lastFetchRef = useRef(0)
  const initialLoadDone = useRef(false)
  const activeConversationRef = useRef(null)

  const setActiveConversation = useCallback((conversationId) => {
    activeConversationRef.current = conversationId
  }, [])

  const fetchConversations = useCallback(async (forceReorder = false) => {
    const now = Date.now()

    if (now - lastFetchRef.current < 500 && !forceReorder) return

    if (!fromNumber) {
      setConversations([])
      setLoading(false)
      initialLoadDone.current = true
      return
    }

    try {
      if (!initialLoadDone.current) {
        setLoading(true)
      }

      const normalizedFromNumber = normalizePhoneNumber(fromNumber)

      // Use API endpoint with workspace context
      const response = await apiGet(`/api/conversations?from_number=${encodeURIComponent(normalizedFromNumber)}`)
      const result = await response.json()

      if (!result.success) throw new Error(result.error || 'Failed to fetch conversations')

      // API already returns processed conversations with lastMessage and unreadCount
      const processedConversations = result.conversations || []

      if (forceReorder || !initialLoadDone.current) {
        setConversations(processedConversations)
      } else {
        setConversations(current => {
          const updatedMap = new Map(processedConversations.map(c => [c.id, c]))
          
          const updatedConversations = current.map(existing => {
            const updated = updatedMap.get(existing.id)
            return updated || existing
          })
          
          const existingIds = new Set(current.map(c => c.id))
          const newConversations = processedConversations.filter(c => !existingIds.has(c.id))
          
          if (newConversations.length > 0) {
            return [...newConversations, ...updatedConversations]
          }
          
          return updatedConversations
        })
      }
      
      lastFetchRef.current = now
      
    } catch (error) {
      console.error('Error fetching conversations:', error)
    } finally {
      if (!initialLoadDone.current) {
        setLoading(false)
        initialLoadDone.current = true
      }
    }
  }, [fromNumber])

  useEffect(() => {
    initialLoadDone.current = false
    fetchConversations(true)

    if (!fromNumber) return

    const normalizedFromNumber = normalizePhoneNumber(fromNumber)

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    channelRef.current = supabase
      .channel(`conversations_${normalizedFromNumber}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          const messageFromNumber = normalizePhoneNumber(payload.new.from_number || '')
          const messageToNumber = normalizePhoneNumber(payload.new.to_number || '')
          
          if (messageFromNumber === normalizedFromNumber || messageToNumber === normalizedFromNumber) {
            if (payload.new.direction === 'inbound') {
              setConversations(current => {
                const conversationIndex = current.findIndex(c => c.id === payload.new.conversation_id)
                
                if (conversationIndex === -1) {
                  setTimeout(() => fetchConversations(true), 1000)
                  return current
                }
                
                const updatedConversations = [...current]
                const conversation = { ...updatedConversations[conversationIndex] }
                
                conversation.unreadCount = (conversation.unreadCount || 0) + 1
                conversation.lastMessage = {
                  body: payload.new.body,
                  direction: payload.new.direction,
                  status: payload.new.status,
                  created_at: payload.new.created_at,
                  read_at: payload.new.read_at
                }
                conversation.last_message_at = payload.new.created_at
                
                if (activeConversationRef.current !== conversation.id) {
                  updatedConversations.splice(conversationIndex, 1)
                  updatedConversations.unshift(conversation)
                } else {
                  updatedConversations[conversationIndex] = conversation
                }
                
                return updatedConversations
              })
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          if (payload.new.read_at && !payload.old.read_at && payload.new.direction === 'inbound') {
            setConversations(current => current.map(conv => {
              if (conv.id === payload.new.conversation_id) {
                const newUnreadCount = Math.max(0, (conv.unreadCount || 0) - 1)
                return {
                  ...conv,
                  unreadCount: newUnreadCount
                }
              }
              return conv
            }))
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          setConversations(current => current.map(conv => {
            if (conv.id === payload.new.id) {
              // Preserve computed contact fields (not in DB) — the raw DB row
              // has `name` set to business_name but the API computes a display
              // name from the linked contact's first/last name.
              const { name: _dbName, ...dbFields } = payload.new
              return {
                ...conv,
                ...dbFields,
                // Only overwrite name if we don't have contact first/last names
                name: (conv.contact_first_name || conv.contact_last_name)
                  ? conv.name
                  : (payload.new.name || conv.name)
              }
            }
            return conv
          }))
        }
      )
      .subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fromNumber, fetchConversations])

  const deleteConversation = useCallback(async (conversationId) => {
    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId)

      if (error) throw error

      setConversations(current => current.filter(conv => conv.id !== conversationId))
      return { success: true }
    } catch (error) {
      console.error('Error deleting conversation:', error)
      return { success: false, error: error.message }
    }
  }, [])

  const updateConversationOptimistic = useCallback((conversationId, updates) => {
    setConversations(current => current.map(conv => {
      if (conv.id === conversationId) {
        return { ...conv, ...updates }
      }
      return conv
    }))
  }, [])

  const refetch = useCallback((allowReorder = false) => {
    fetchConversations(allowReorder)
  }, [fetchConversations])

  return {
    conversations,
    loading,
    refetch,
    deleteConversation,
    setActiveConversation,
    updateConversationOptimistic
  }
}