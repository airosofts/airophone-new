// src/lib/supabase.js - Clean version without auth helpers
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Simple client for basic operations (no auth)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// Create supabase client function (clean version)
export const createSupabaseClient = () => createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// Helper functions for client-side operations (updated without auth helpers)
export const clientHelpers = {
  async getConversations(fromNumber) {
    let query = supabase
      .from('conversations')
      .select(`
        *,
        messages (
          body,
          created_at,
          direction,
          status,
          read_at
        )
      `)
      .order('last_message_at', { ascending: false })

    // Filter by from_number if provided
    if (fromNumber) {
      query = query.eq('from_number', fromNumber)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching conversations:', error)
      throw error
    }

    return data.map(conv => ({
      ...conv,
      lastMessage: conv.messages?.[0] || null,
      unreadCount: conv.messages?.filter(msg => 
        msg.direction === 'inbound' && !msg.read_at
      ).length || 0,
      messages: undefined // Remove messages array to keep response clean
    }))
  },

  async getConversationMessages(conversationId, limit = 50) {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('Error fetching messages:', error)
      throw error
    }

    return data
  },

  async createConversation(phoneNumber, name = null, fromNumber = null) {
    // First try to get existing conversation
    let { data: conversation, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single()

    if (error && error.code === 'PGRST116') {
      // Conversation doesn't exist, create it
      const { data: newConversation, error: createError } = await supabase
        .from('conversations')
        .insert({
          phone_number: phoneNumber,
          name: name,
          from_number: fromNumber
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating conversation:', createError)
        throw createError
      }

      conversation = newConversation
    } else if (error) {
      console.error('Error fetching conversation:', error)
      throw error
    }

    return conversation
  }
}