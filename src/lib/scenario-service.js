import { supabaseAdmin } from '@/lib/supabase-server'
import { getAIResponse } from '@/lib/openai'
import telnyx from '@/lib/telnyx'
import { getWorkspaceMessageRate } from '@/lib/pricing'
import {
  isWithinBusinessHours,
  updateFollowupState,
  scheduleNextFollowup,
  addConversationLabel,
  toggleManualOverride
} from '@/lib/followup-service'

// Canonical custom_fields format is {key: value}. Some legacy rows were saved
// from the inbox panel as [{id,label,type,value}]; coerce those on read.
function normalizeCustomFields(cf) {
  if (!cf) return {}
  if (Array.isArray(cf)) {
    const out = {}
    for (const f of cf) {
      const label = f?.label
      if (!label) continue
      const key = String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      if (key) out[key] = f?.value
    }
    return out
  }
  return cf
}

export async function findMatchingScenario(recipientNumber, senderNumber) {
  try {
    // First, find all phone number records with this phone number
    const { data: phoneRecords, error: phoneRecordError } = await supabaseAdmin
      .from('phone_numbers')
      .select('id')
      .eq('phone_number', recipientNumber)

    if (phoneRecordError || !phoneRecords || phoneRecords.length === 0) {
      console.log(`No phone number record found for ${recipientNumber}`)
      return null
    }

    // Get all phone IDs for this number
    const phoneIds = phoneRecords.map(p => p.id)

    // Find scenarios assigned to any of these phone number IDs
    const { data: scenarioPhoneNumbers, error: phoneError } = await supabaseAdmin
      .from('scenario_phone_numbers')
      .select(`
        scenario_id,
        scenarios (
          id,
          workspace_id,
          name,
          instructions,
          is_active,
          enable_followups,
          max_followup_attempts,
          enable_business_hours,
          business_hours_start,
          business_hours_end,
          business_hours_timezone,
          auto_stop_keywords,
          restrict_to_contact_lists
        )
      `)
      .in('phone_number_id', phoneIds)

    if (phoneError) {
      console.error('Error finding scenarios:', phoneError)
      return null
    }

    // Filter active scenarios in JS — avoids issues with PostgREST embedded table filters
    const active = (scenarioPhoneNumbers || []).filter(item => item.scenarios?.is_active === true)

    if (active.length === 0) {
      console.log(`No active scenarios found for phone ${recipientNumber}`)
      return null
    }

    // Replace scenarioPhoneNumbers with active-only list
    const filteredScenarios = active

    // Priority 1: Explicit individual contact assignment
    for (const item of filteredScenarios) {
      const scenario = item.scenarios

      const { data: explicitMatch } = await supabaseAdmin
        .from('scenario_contacts')
        .select('id')
        .eq('scenario_id', scenario.id)
        .eq('recipient_phone', senderNumber)
        .limit(1)
        .maybeSingle()

      if (explicitMatch) {
        return scenario
      }
    }

    // Priority 2: Contact list restriction — sender must be in one of the allowed lists
    for (const item of filteredScenarios) {
      const scenario = item.scenarios
      const listIds = scenario.restrict_to_contact_lists

      if (listIds && listIds.length > 0) {
        const { data: contactInList } = await supabaseAdmin
          .from('contacts')
          .select('id')
          .eq('workspace_id', scenario.workspace_id)
          .eq('phone_number', senderNumber)
          .in('contact_list_id', listIds)
          .limit(1)
          .maybeSingle()

        if (contactInList) {
          return scenario
        }
        // Has list restriction but sender not in list — skip this scenario
        continue
      }

      // Priority 3: Unrestricted — no individual contacts AND no list restrictions
      const { data: anyContacts } = await supabaseAdmin
        .from('scenario_contacts')
        .select('id')
        .eq('scenario_id', scenario.id)
        .limit(1)

      if (!anyContacts || anyContacts.length === 0) {
        return scenario
      }
    }

    return null
  } catch (error) {
    console.error('Error in findMatchingScenario:', error)
    return null
  }
}

export async function executeScenario(scenario, message, conversation) {
  const startTime = Date.now()
  const executionLog = {
    scenario_id: scenario.id,
    conversation_id: conversation.id,
    message_id: message.id,
    sender_number: message.from_number,
    recipient_number: message.to_number,
    execution_status: 'processing',
    reply_sent: false
  }

  try {
    // Check business hours if enabled
    if (!isWithinBusinessHours(scenario)) {
      console.log(`Outside business hours for scenario ${scenario.id} - skipping execution`)
      executionLog.execution_status = 'skipped_business_hours'
      executionLog.processing_time_ms = Date.now() - startTime
      await logScenarioExecution(executionLog)
      return { success: true, skipped: true, reason: 'business_hours' }
    }

    // Get conversation history
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('messages')
      .select('id, direction, body, from_number, to_number, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })

    if (messagesError) {
      throw new Error(`Failed to fetch conversation history: ${messagesError.message}`)
    }

    // Format conversation history for AI
    const conversationHistory = messages.map(msg => ({
      direction: msg.direction,
      body: msg.body,
      from: msg.from_number,
      to: msg.to_number,
      timestamp: msg.created_at
    }))

    executionLog.conversation_history = conversationHistory

    // Look up the contact and substitute {{key}} tokens in instructions
    let instructions = scenario.instructions
    const { data: contactRecord, error: contactLookupError } = await supabaseAdmin
      .from('contacts')
      .select('first_name, last_name, business_name, phone_number, email, city, state, country, custom_fields')
      .eq('workspace_id', scenario.workspace_id)
      .eq('phone_number', message.from_number)
      .limit(1)
      .single()

    if (contactLookupError && contactLookupError.code !== 'PGRST116') {
      console.error('Error looking up contact for substitution:', contactLookupError.message)
    }

    // Defensive: ContactPanel.js historically stored custom_fields as an array
    // of {id,label,type,value} — coerce to {key:value} so {{tokens}} resolve.
    const customFields = normalizeCustomFields(contactRecord?.custom_fields)
    const substitutions = contactRecord ? {
      first_name: contactRecord.first_name || '',
      last_name: contactRecord.last_name || '',
      business_name: contactRecord.business_name || '',
      phone_number: contactRecord.phone_number || '',
      email: contactRecord.email || '',
      city: contactRecord.city || '',
      state: contactRecord.state || '',
      country: contactRecord.country || '',
      ...customFields,
    } : {}

    // Substitute known tags; remove unknown ones so AI doesn't see raw {{placeholders}}
    instructions = instructions.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      substitutions[key] !== undefined ? substitutions[key] : ''
    )

    if (contactRecord) {
      console.log(`[scenario] Substituted contact data for ${message.from_number}: ${JSON.stringify(substitutions)}`)
    } else {
      console.log(`[scenario] No contact found for ${message.from_number}, placeholders removed`)
    }

    // Build AI prompt
    const aiPrompt = `${instructions}

IMPORTANT RULES:
1. Follow the scenario instructions strictly
2. Keep responses concise and natural
3. If the scenario says to stop responding, return exactly: "STOP_SCENARIO"
4. If you cannot help the customer or need human assistance (e.g., unable to meet their requirements after multiple attempts), return exactly: "NEED_HUMAN"
5. Never mention you are an AI or bot
6. Stay in character based on the scenario

Current conversation:`

    executionLog.ai_prompt = aiPrompt

    // Get AI response
    const aiResult = await getAIResponse(conversationHistory, aiPrompt)

    if (!aiResult.success) {
      executionLog.execution_status = 'failed'
      executionLog.error_message = aiResult.error
      executionLog.processing_time_ms = Date.now() - startTime
      await logScenarioExecution(executionLog)
      return { success: false, error: aiResult.error }
    }

    executionLog.ai_response = aiResult.response
    executionLog.tokens_used = aiResult.tokensUsed
    executionLog.ai_model = aiResult.model

    // Check if AI wants to stop
    if (aiResult.response.includes('STOP_SCENARIO')) {
      executionLog.execution_status = 'no_reply'
      executionLog.processing_time_ms = Date.now() - startTime
      await logScenarioExecution(executionLog)
      return { success: true, stopped: true }
    }

    // Check if AI needs human intervention
    if (aiResult.response.includes('NEED_HUMAN') || aiResult.response.includes('HUMAN_NEEDED')) {
      console.log(`AI requested human intervention for conversation ${conversation.id}`)

      // Add "Need human" label to the conversation
      await addConversationLabel(conversation.id, 'Need human')

      // Set manual override to stop AI from responding further
      await toggleManualOverride(conversation.id, true)

      // Send transitional message to customer
      const humanNeededMessage = "Thank you for your patience. One of our team members will be with you shortly to assist with your request."
      await telnyx.sendMessage(
        message.to_number, // from (our number)
        message.from_number, // to (their number)
        humanNeededMessage
      )

      // Create message record for the transitional message
      await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          direction: 'outbound',
          from_number: message.to_number,
          to_number: message.from_number,
          body: humanNeededMessage,
          status: 'sent'
        })

      // Log execution as human_needed
      executionLog.execution_status = 'human_needed'
      executionLog.processing_time_ms = Date.now() - startTime
      await logScenarioExecution(executionLog)

      return { success: true, humanNeeded: true }
    }

    // Apply random reply delay if configured (humanize AI responses)
    console.log(`[AI delay] scenario.workspace_id = "${scenario.workspace_id}"`)
    const { data: aiSettings, error: aiSettingsError } = await supabaseAdmin
      .from('workspace_ai_settings')
      .select('ai_reply_delay_min, ai_reply_delay_max')
      .eq('workspace_id', scenario.workspace_id)
      .single()

    if (aiSettingsError && aiSettingsError.code !== 'PGRST116') {
      console.error('AI settings lookup error (table may not exist — run SQL migration):', aiSettingsError.message)
    }

    if (aiSettings) {
      const min = Math.max(0, aiSettings.ai_reply_delay_min || 0)
      const max = Math.max(0, aiSettings.ai_reply_delay_max || 0)
      console.log(`AI delay settings for workspace ${scenario.workspace_id}: min=${min}s max=${max}s`)
      if (max > 0) {
        const range = max >= min ? max - min : 0
        const delayMs = (Math.floor(Math.random() * (range + 1)) + min) * 1000
        console.log(`AI reply delay: waiting ${delayMs}ms before sending`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else {
        console.log('AI delay: max=0, sending immediately')
      }
    } else {
      console.log(`AI delay: no settings found for workspace ${scenario.workspace_id}, sending immediately`)
    }

    // Send reply via Telnyx
    const sendResult = await telnyx.sendMessage(
      message.to_number, // from (our number)
      message.from_number, // to (their number)
      aiResult.response
    )

    if (!sendResult.success) {
      executionLog.execution_status = 'failed'
      executionLog.error_message = `Failed to send message: ${sendResult.error}`
      executionLog.processing_time_ms = Date.now() - startTime
      await logScenarioExecution(executionLog)
      return { success: false, error: sendResult.error }
    }

    // Create message record with AI tracking
    const { data: replyMessage, error: replyError } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        telnyx_message_id: sendResult.messageId,
        direction: 'outbound',
        from_number: message.to_number,
        to_number: message.from_number,
        body: aiResult.response,
        status: 'sent',
        tokens_used: aiResult.tokensUsed,
        processing_time_ms: aiResult.processingTime,
        ai_model: aiResult.model
      })
      .select()
      .single()

    if (replyError) {
      console.error('Failed to create reply message record:', replyError)
    }

    // Update execution log
    executionLog.reply_sent = true
    executionLog.reply_message_id = replyMessage?.id
    executionLog.execution_status = 'success'
    executionLog.processing_time_ms = Date.now() - startTime

    await logScenarioExecution(executionLog)

    // Deduct 2 credits for AI scenario reply
    await deductScenarioCredits(scenario.workspace_id, replyMessage?.id, message.from_number)

    // Update follow-up state (AI sent a message)
    await updateFollowupState(conversation.id, scenario.id, 'ai')

    // Schedule next follow-up if enabled
    await scheduleNextFollowup(conversation.id, scenario.id)

    return {
      success: true,
      reply: aiResult.response,
      messageId: sendResult.messageId
    }

  } catch (error) {
    console.error('Error executing scenario:', error)
    executionLog.execution_status = 'failed'
    executionLog.error_message = error.message
    executionLog.processing_time_ms = Date.now() - startTime
    await logScenarioExecution(executionLog)
    return { success: false, error: error.message }
  }
}

async function deductScenarioCredits(workspaceId, messageId, recipientPhone) {
  try {
    // Get the wallet's user_id via workspace_id (shared workspace wallet)
    const { data: wallet, error: wsError } = await supabaseAdmin
      .from('wallets')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .single()

    if (wsError || !wallet?.user_id) {
      console.error('Could not find workspace wallet for credit deduction:', wsError)
      return
    }

    const userId = wallet.user_id
    const messageRate = await getWorkspaceMessageRate(workspaceId)
    const totalCost = messageRate * 2

    // Deduct 2 credits (AI reply counts as 2 messages)
    const { data: deductionResult, error: deductionError } = await supabaseAdmin.rpc(
      'deduct_message_cost',
      {
        p_user_id: userId,
        p_workspace_id: workspaceId,
        p_message_count: 2,
        p_cost_per_message: messageRate,
        p_description: `AI scenario reply to ${recipientPhone}`,
        p_campaign_id: null,
        p_message_id: messageId,
        p_recipient_phone: recipientPhone
      }
    )

    if (deductionError || !deductionResult?.success) {
      console.error('Error deducting AI scenario credits:', deductionError || deductionResult)
      return
    }

    // Log to message_transactions
    await supabaseAdmin
      .from('message_transactions')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        campaign_id: null,
        message_id: messageId,
        recipient_phone: recipientPhone,
        cost_per_message: messageRate,
        total_cost: totalCost,
        message_type: 'ai_scenario',
        status: 'sent'
      })

    console.log(`Deducted 2 credits for AI scenario reply to ${recipientPhone}`)
  } catch (error) {
    console.error('Error in deductScenarioCredits:', error)
  }
}

async function logScenarioExecution(executionLog) {
  try {
    const { error } = await supabaseAdmin
      .from('scenario_executions')
      .insert(executionLog)

    if (error) {
      console.error('Failed to log scenario execution:', error)
    }
  } catch (error) {
    console.error('Error logging scenario execution:', error)
  }
}
