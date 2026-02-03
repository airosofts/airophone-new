// src/lib/telnyx.js - Fixed for development mode
import axios from 'axios'

const TELNYX_API_BASE = 'https://api.telnyx.com/v2'

class TelnyxClient {
  constructor() {
    this.apiKey = process.env.TELNYX_API_KEY
    this.profileId = process.env.TELNYX_PROFILE_ID

    if (!this.apiKey || !this.profileId) {
      throw new Error('Missing Telnyx configuration. Check TELNYX_API_KEY and TELNYX_PROFILE_ID in environment variables.')
    }

    this.client = axios.create({
      baseURL: TELNYX_API_BASE,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    })
  }

  // Check if we're in development mode
  isDevelopment() {
    return process.env.NODE_ENV === 'development' || 
           process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost') ||
           process.env.NEXT_PUBLIC_SITE_URL?.includes('127.0.0.1')
  }

  // Format phone number to E.164 format
  toE164(phoneNumber) {
    const digits = String(phoneNumber).replace(/\D/g, '')
    if (digits.startsWith('1') && digits.length === 11) {
      return `+${digits}`
    }
    if (digits.length === 10) {
      return `+1${digits}`
    }
    return phoneNumber
  }

  // Get all available phone numbers from Telnyx
  async getPhoneNumbers() {
    try {
      console.log('Fetching phone numbers from Telnyx API...')

      let phoneNumbers = []

      // Try different approaches to get phone numbers
      try {
        const response = await this.client.get('/phone_numbers', {
          params: { 'page[size]': 250 }
        })
        
        if (response.data && response.data.data) {
          phoneNumbers = response.data.data
          console.log(`Found ${phoneNumbers.length} phone numbers`)
        }
      } catch (error) {
        console.log('Error fetching phone numbers:', error.response?.data || error.message)
        
        // Try with purchased filter
        try {
          const response2 = await this.client.get('/phone_numbers', {
            params: {
              'filter[status]': 'purchased',
              'page[size]': 250
            }
          })
          
          if (response2.data && response2.data.data) {
            phoneNumbers = response2.data.data
            console.log(`Found ${phoneNumbers.length} purchased phone numbers`)
          }
        } catch (error2) {
          console.log('Error fetching purchased numbers:', error2.response?.data || error2.message)
        }
      }

      if (phoneNumbers.length > 0) {
        const processedNumbers = phoneNumbers.map(number => ({
          id: number.id,
          phoneNumber: number.phone_number,
          status: number.status,
          recordType: number.record_type,
          messagingProfileId: number.messaging_profile_id,
          voiceProfileId: number.voice_profile_id,
          purchasedAt: number.purchased_at,
          capabilities: this.extractCapabilities(number)
        }))

        console.log('Processed phone numbers:', JSON.stringify(processedNumbers, null, 2))

        return {
          success: true,
          phoneNumbers: processedNumbers
        }
      } else {
        return {
          success: true,
          phoneNumbers: []
        }
      }

    } catch (error) {
      console.error('Error fetching phone numbers:', error.response?.data || error.message)
      
      return {
        success: false,
        error: error.response?.data || error.message,
        phoneNumbers: []
      }
    }
  }

  extractCapabilities(number) {
    const capabilities = []
    
    if (number.messaging_profile_id) {
      capabilities.push('sms')
    }
    
    if (number.voice_profile_id) {
      capabilities.push('voice')
    }

    if (number.features && Array.isArray(number.features)) {
      capabilities.push(...number.features)
    }

    if (number.capabilities && Array.isArray(number.capabilities)) {
      capabilities.push(...number.capabilities)
    }

    return [...new Set(capabilities)]
  }

  // Send SMS message with conditional webhook URLs
  async sendMessage(from, to, text, options = {}) {
    try {
      const payload = {
        from: this.toE164(from),
        to: this.toE164(to),
        text: text,
        messaging_profile_id: this.profileId,
        ...options
      }

      // Only add webhook URLs in production
      if (!this.isDevelopment()) {
        payload.webhook_url = `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/telnyx`
        payload.webhook_failover_url = `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/telnyx/failover`
        payload.use_profile_webhooks = false
        console.log('Production mode: Adding webhook URLs')
      } else {
        // In development, use profile webhooks or no webhooks
        payload.use_profile_webhooks = true
        console.log('Development mode: Using profile webhooks')
      }

      console.log('Sending SMS via Telnyx:', JSON.stringify(payload, null, 2))

      const response = await this.client.post('/messages', payload)
      
      if (response.data && response.data.data) {
        console.log('SMS sent successfully:', response.data.data.id)
        return {
          success: true,
          messageId: response.data.data.id,
          data: response.data.data
        }
      } else {
        throw new Error('Invalid response format from Telnyx')
      }
    } catch (error) {
      console.error('Error sending SMS:', error.response?.data || error.message)
      
      return {
        success: false,
        error: error.response?.data || error.message,
        messageId: null
      }
    }
  }

  // Send bulk messages
  async sendBulkMessages(from, recipients, text, options = {}) {
    const results = []
    const delay = options.delay || 1000
    
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i]
      
      try {
        const result = await this.sendMessage(from, recipient, text, options)
        results.push({
          recipient,
          ...result
        })
        
        console.log(`[${i + 1}/${recipients.length}] ${recipient}: ${result.success ? 'SUCCESS' : 'FAILED'}`)
        
        if (i < recipients.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      } catch (error) {
        console.error(`Error sending to ${recipient}:`, error)
        results.push({
          recipient,
          success: false,
          error: error.message,
          messageId: null
        })
      }
    }
    
    const successful = results.filter(r => r.success).length
    const failed = results.length - successful
    
    console.log(`Bulk SMS complete. Sent: ${successful}, Failed: ${failed}`)
    
    return {
      results,
      summary: { successful, failed, total: results.length }
    }
  }

  verifyWebhookSignature(payload, signature, timestamp) {
    if (!signature || !timestamp) {
      return false
    }
    return true
  }

  parseWebhookEvent(body) {
    try {
      if (typeof body === 'string') {
        body = JSON.parse(body)
      }

      const event = body.data
      
      if (!event || !event.event_type) {
        throw new Error('Invalid webhook format')
      }

      return {
        eventType: event.event_type,
        messageId: event.id,
        payload: event.payload,
        occurredAt: event.occurred_at,
        recordType: event.record_type
      }
    } catch (error) {
      console.error('Error parsing webhook event:', error)
      throw new Error('Failed to parse webhook event')
    }
  }

  async getMessageStatus(messageId) {
    try {
      const response = await this.client.get(`/messages/${messageId}`)
      return {
        success: true,
        data: response.data.data
      }
    } catch (error) {
      console.error('Error getting message status:', error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data || error.message
      }
    }
  }

  async getMessagingProfile(profileId = null) {
    try {
      const id = profileId || this.profileId
      const response = await this.client.get(`/messaging_profiles/${id}`)
      return {
        success: true,
        data: response.data.data
      }
    } catch (error) {
      console.error('Error getting messaging profile:', error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data || error.message
      }
    }
  }

}

const telnyx = new TelnyxClient()

export default telnyx

export const {
  sendMessage,
  sendBulkMessages,
  verifyWebhookSignature,
  parseWebhookEvent,
  getMessageStatus,
  getPhoneNumbers,
  getMessagingProfile,
  toE164
} = telnyx