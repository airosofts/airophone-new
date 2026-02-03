// src/lib/supabase-server.js
import { createClient } from '@supabase/supabase-js'

// Ensure environment variables are defined
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
}

// Service role client (for API routes that need elevated privileges)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY, 
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// Export a function to create Supabase client for server-side operations
export function createSupabaseServerClient() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not initialized')
  }
  return supabaseAdmin
}

// Comprehensive error handling wrapper
async function safeDbOperation(operation, errorMessage = 'Database operation failed') {
  try {
    return await operation()
  } catch (error) {
    console.error(errorMessage, error)
    throw error
  }
}

// Expanded helper functions
export const databaseHelpers = {
  // Conversation helpers
  conversations: {
    async getOrCreateConversation(phoneNumber, name = null, fromNumber = null) {
      return safeDbOperation(async () => {
        // Try RPC function first
        const { data, error: rpcError } = await supabaseAdmin.rpc('get_or_create_conversation', {
          p_phone_number: phoneNumber,
          p_name: name,
          p_from_number: fromNumber
        })

        if (rpcError) {
          console.warn('RPC function failed, falling back to manual method', rpcError)
          
          // Manual fallback method
          let { data: conversation, error } = await supabaseAdmin
            .from('conversations')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single()

          if (error) {
            // Create new conversation if not exists
            if (error.code === 'PGRST116') {
              const { data: newConversation, error: insertError } = await supabaseAdmin
                .from('conversations')
                .insert({
                  phone_number: phoneNumber,
                  name: name,
                  from_number: fromNumber
                })
                .select()
                .single()

              if (insertError) throw insertError
              return newConversation
            }
            throw error
          }

          // Update from_number if not set
          if (fromNumber && !conversation.from_number) {
            const { data: updatedConversation, error: updateError } = await supabaseAdmin
              .from('conversations')
              .update({ from_number: fromNumber })
              .eq('id', conversation.id)
              .select()
              .single()

            if (updateError) throw updateError
            return updatedConversation
          }

          return conversation
        }

        // Return conversation from RPC function
        return data
      }, 'Error in getOrCreateConversation')
    },

    async getAllConversations(fromNumber = null) {
      return safeDbOperation(async () => {
        let query = supabaseAdmin
          .from('conversations')
          .select(`
            *,
            messages (
              body,
              created_at,
              direction,
              status
            )
          `)
          .order('last_message_at', { ascending: false })

        if (fromNumber) {
          query = query.eq('from_number', fromNumber)
        }

        const { data, error } = await query

        if (error) throw error

        return data.map(conv => ({
          ...conv,
          lastMessage: conv.messages && conv.messages.length > 0 
            ? conv.messages[conv.messages.length - 1] 
            : null,
          messages: undefined
        }))
      }, 'Error fetching conversations')
    }
  },

  // Message helpers
  messages: {
    async createMessage(messageData) {
      return safeDbOperation(async () => {
        const { data, error } = await supabaseAdmin
          .from('messages')
          .insert(messageData)
          .select()
          .single()

        if (error) throw error
        return data
      }, 'Error creating message')
    },

    async updateMessageStatus(telnyxMessageId, status, additionalData = {}) {
      return safeDbOperation(async () => {
        const updateData = { 
          status, 
          ...additionalData,
          updated_at: new Date().toISOString() 
        }

        const { data, error } = await supabaseAdmin
          .from('messages')
          .update(updateData)
          .eq('telnyx_message_id', telnyxMessageId)
          .select()
          .single()

        if (error) throw error
        return data
      }, 'Error updating message status')
    }
  },

  // Phone number helpers
  phoneNumbers: {
    async getActivePhoneNumbers() {
      return safeDbOperation(async () => {
        const { data, error } = await supabaseAdmin
          .from('phone_numbers')
          .select('*')
          .eq('is_active', true)
          .order('phone_number')

        if (error) throw error
        return data || []
      }, 'Error fetching active phone numbers')
    }
  }
}