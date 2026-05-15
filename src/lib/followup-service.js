// Follow-up Service
// Handles automatic follow-ups, STOP keywords, business hours, and manual takeover

import { supabaseAdmin } from './supabase-server'

/**
 * Check if message contains STOP keywords
 */
export function containsStopKeyword(message, stopKeywords) {
  if (!message || !stopKeywords || stopKeywords.length === 0) {
    return false
  }

  const normalizedMessage = message.toUpperCase().trim()
  return stopKeywords.some(keyword =>
    normalizedMessage === keyword ||
    normalizedMessage.includes(` ${keyword} `) ||
    normalizedMessage.startsWith(`${keyword} `) ||
    normalizedMessage.endsWith(` ${keyword}`)
  )
}

/**
 * Check if current time is within business hours
 */
export function isWithinBusinessHours(scenario) {
  if (!scenario.enable_business_hours) {
    return true // Business hours not enabled, always allow
  }

  const now = new Date()
  const timezone = scenario.business_hours_timezone || 'America/New_York'

  // Convert current time to scenario's timezone
  const timeInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
  const currentHour = timeInTz.getHours()
  const currentMinute = timeInTz.getMinutes()
  const currentTime = currentHour * 60 + currentMinute // minutes since midnight

  // Parse business hours
  const [startHour, startMinute] = (scenario.business_hours_start || '09:00:00').split(':').map(Number)
  const [endHour, endMinute] = (scenario.business_hours_end || '18:00:00').split(':').map(Number)

  const startTime = startHour * 60 + startMinute
  const endTime = endHour * 60 + endMinute

  return currentTime >= startTime && currentTime <= endTime
}

/**
 * Initialize or update follow-up state for a conversation
 */
export async function updateFollowupState(conversationId, scenarioId, messageFrom = 'customer') {
  try {
    // Get scenario settings
    const { data: scenario } = await supabaseAdmin
      .from('scenarios')
      .select('enable_followups, max_followup_attempts')
      .eq('id', scenarioId)
      .single()

    if (!scenario || !scenario.enable_followups) {
      return { success: true, followupEnabled: false }
    }

    // Get or create follow-up state
    const { data: existingState } = await supabaseAdmin
      .from('conversation_followup_state')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('scenario_id', scenarioId)
      .single()

    const now = new Date()

    if (existingState) {
      // Update existing state
      const updates = {
        last_message_from: messageFrom,
        last_message_at: now.toISOString(),
        updated_at: now.toISOString()
      }

      // If customer responded, reset next_followup_at (we'll calculate it after AI responds)
      if (messageFrom === 'customer') {
        updates.next_followup_at = null
      }

      await supabaseAdmin
        .from('conversation_followup_state')
        .update(updates)
        .eq('id', existingState.id)
    } else {
      // Create new state
      await supabaseAdmin
        .from('conversation_followup_state')
        .insert({
          conversation_id: conversationId,
          scenario_id: scenarioId,
          current_stage: 0,
          total_attempts: 0,
          last_message_from: messageFrom,
          last_message_at: now.toISOString()
        })
    }

    return { success: true, followupEnabled: true }
  } catch (error) {
    console.error('Error updating follow-up state:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Schedule next follow-up after AI responds
 */
export async function scheduleNextFollowup(conversationId, scenarioId) {
  try {
    // Get follow-up state
    const { data: state } = await supabaseAdmin
      .from('conversation_followup_state')
      .select('*, scenarios(enable_followups, max_followup_attempts)')
      .eq('conversation_id', conversationId)
      .eq('scenario_id', scenarioId)
      .single()

    if (!state || state.stopped || !state.scenarios?.enable_followups) {
      return { success: true, scheduled: false }
    }

    // Check if max attempts reached
    if (state.total_attempts >= state.scenarios.max_followup_attempts) {
      await supabaseAdmin
        .from('conversation_followup_state')
        .update({
          stopped: true,
          stopped_at: new Date().toISOString()
        })
        .eq('id', state.id)

      return { success: true, scheduled: false, reason: 'max_attempts_reached' }
    }

    // Get next follow-up stage
    const nextStage = state.current_stage + 1
    const { data: followupStage } = await supabaseAdmin
      .from('scenario_followup_stages')
      .select('*')
      .eq('scenario_id', scenarioId)
      .eq('stage_number', nextStage)
      .single()

    if (!followupStage) {
      // No more follow-up stages defined
      return { success: true, scheduled: false, reason: 'no_more_stages' }
    }

    // Calculate next follow-up time (respect wait_unit: minutes / hours / days)
    const nextFollowupAt = new Date()
    const unit = (followupStage.wait_unit || 'minutes').toLowerCase()
    if (unit === 'days') {
      nextFollowupAt.setDate(nextFollowupAt.getDate() + followupStage.wait_duration)
    } else if (unit === 'hours') {
      nextFollowupAt.setHours(nextFollowupAt.getHours() + followupStage.wait_duration)
    } else {
      nextFollowupAt.setMinutes(nextFollowupAt.getMinutes() + followupStage.wait_duration)
    }

    // Update state with next follow-up time
    await supabaseAdmin
      .from('conversation_followup_state')
      .update({
        next_followup_at: nextFollowupAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', state.id)

    return {
      success: true,
      scheduled: true,
      nextFollowupAt: nextFollowupAt.toISOString(),
      stage: nextStage
    }
  } catch (error) {
    console.error('Error scheduling follow-up:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Check for conversations that need follow-ups and send them
 */
export async function processScheduledFollowups() {
  try {
    const now = new Date()

    // Find all conversations due for follow-up
    const { data: dueFollowups, error } = await supabaseAdmin
      .from('conversation_followup_state')
      .select(`
        *,
        conversations (
          id,
          phone_number,
          from_number,
          manual_override
        ),
        scenarios (
          id,
          instructions,
          workspace_id,
          enable_business_hours,
          business_hours_start,
          business_hours_end,
          business_hours_timezone
        )
      `)
      .eq('stopped', false)
      .lte('next_followup_at', now.toISOString())
      .not('next_followup_at', 'is', null)

    if (error) {
      console.error('Error fetching due follow-ups:', error)
      return { success: false, error: error.message }
    }

    if (!dueFollowups || dueFollowups.length === 0) {
      return { success: true, processed: 0 }
    }

    console.log(`Found ${dueFollowups.length} conversations due for follow-up`)

    let processed = 0
    let skipped = 0

    for (const followupState of dueFollowups) {
      // Skip if manual override is active
      if (followupState.conversations?.manual_override) {
        console.log(`Skipping conversation ${followupState.conversation_id} - manual override active`)
        skipped++
        continue
      }

      // Check business hours
      if (!isWithinBusinessHours(followupState.scenarios)) {
        console.log(`Skipping conversation ${followupState.conversation_id} - outside business hours`)
        // Reschedule for next hour
        const nextHour = new Date()
        nextHour.setHours(nextHour.getHours() + 1)
        await supabaseAdmin
          .from('conversation_followup_state')
          .update({ next_followup_at: nextHour.toISOString() })
          .eq('id', followupState.id)
        skipped++
        continue
      }

      // Get follow-up stage instructions
      const nextStage = followupState.current_stage + 1
      const { data: stage } = await supabaseAdmin
        .from('scenario_followup_stages')
        .select('*')
        .eq('scenario_id', followupState.scenario_id)
        .eq('stage_number', nextStage)
        .single()

      if (!stage) {
        console.log(`No stage ${nextStage} found for scenario ${followupState.scenario_id}`)
        await supabaseAdmin
          .from('conversation_followup_state')
          .update({
            stopped: true,
            stopped_at: now.toISOString()
          })
          .eq('id', followupState.id)
        skipped++
        continue
      }

      // Send follow-up message — pass scenario persona so the AI stays in character
      const result = await sendFollowupMessage(
        followupState.conversation_id,
        followupState.scenario_id,
        stage.instructions,
        followupState.scenarios?.instructions || '',
        followupState.scenarios?.workspace_id || null,
        nextStage
      )

      if (result.success) {
        // Update state
        await supabaseAdmin
          .from('conversation_followup_state')
          .update({
            current_stage: nextStage,
            total_attempts: followupState.total_attempts + 1,
            last_message_from: 'ai',
            last_message_at: now.toISOString(),
            next_followup_at: null, // Will be rescheduled if customer doesn't respond
            updated_at: now.toISOString()
          })
          .eq('id', followupState.id)

        // Schedule next follow-up
        await scheduleNextFollowup(
          followupState.conversation_id,
          followupState.scenario_id
        )

        processed++
      } else {
        console.error(`Failed to send follow-up for conversation ${followupState.conversation_id}:`, result.error)
        skipped++
      }
    }

    return {
      success: true,
      total: dueFollowups.length,
      processed,
      skipped
    }
  } catch (error) {
    console.error('Error processing scheduled follow-ups:', error)
    return { success: false, error: error.message }
  }
}

// OTP / verification / carrier auto-reply patterns — kept here to avoid
// pulling the heavier import from scenario-service.
const FOLLOWUP_AUTOMATED_PATTERNS = [
  /verification code/i,
  /\bverify\b.*\bcode\b/i,
  /\bone[\s-]?time\b.*\bcode\b/i,
  /\bOTP\b/i,
  /your .* code is\b/i,
  /your code is\b/i,
  /^\s*\d{4,8}\s*(is your)?/i,
  /do not (share|reply)/i,
  /this code (will )?expires?/i,
  /\bvalid for \d+ (min|hour)/i,
  /^STOP/i,
  /reply (STOP|HELP)/i,
]
function isAutomatedFollowupMessage(body) {
  if (!body) return false
  const s = String(body).trim()
  if (s.length < 6) return false
  return FOLLOWUP_AUTOMATED_PATTERNS.some(rx => rx.test(s))
}

/**
 * Send a follow-up message using AI.
 * `stageInstructions` is the stage-specific nudge text; `scenarioInstructions`
 * is the parent scenario's persona — both are sent to the AI so it stays in
 * character instead of generating generic "you there?" messages.
 */
async function sendFollowupMessage(conversationId, scenarioId, stageInstructions, scenarioInstructions, workspaceId, stage) {
  try {
    // Get conversation details and history
    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    if (!conversation) {
      return { success: false, error: 'Conversation not found' }
    }

    const { data: rawMessages } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    // Drop OTP / verification noise from history
    const messages = (rawMessages || []).filter(m =>
      m.direction === 'outbound' || !isAutomatedFollowupMessage(m.body)
    )

    // Look up contact for {{token}} substitution
    let combinedInstructions = [scenarioInstructions || '', stageInstructions || '']
      .filter(Boolean)
      .join('\n\n--- FOLLOW-UP STAGE ' + stage + ' INSTRUCTIONS ---\n')

    if (workspaceId && conversation.phone_number) {
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .select('first_name, last_name, business_name, phone_number, email, city, state, country, custom_fields')
        .eq('workspace_id', workspaceId)
        .eq('phone_number', conversation.phone_number)
        .maybeSingle()
      if (contact) {
        const subs = {
          first_name: contact.first_name || '',
          last_name: contact.last_name || '',
          business_name: contact.business_name || '',
          phone_number: contact.phone_number || '',
          email: contact.email || '',
          city: contact.city || '',
          state: contact.state || '',
          country: contact.country || '',
          ...(Array.isArray(contact.custom_fields) ? {} : (contact.custom_fields || {})),
        }
        const unresolved = new Set()
        combinedInstructions = combinedInstructions.replace(/\{\{(\w+)\}\}/g, (_, key) => {
          if (subs[key] === undefined || subs[key] === '') {
            unresolved.add(key)
            return ''
          }
          return subs[key]
        })
        if (unresolved.size > 0) {
          console.warn(`[followup] Unresolved tokens: ${[...unresolved].join(', ')} (conversation ${conversationId})`)
        }
      }
    }

    // Generate AI response using combined instructions
    const { getAIResponse } = await import('./openai')
    const aiResult = await getAIResponse(messages, combinedInstructions)

    if (!aiResult.success) {
      return { success: false, error: aiResult.error }
    }

    // Send the message via Telnyx
    const sendResult = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: conversation.phone_number,
        from: conversation.from_number,
        message: aiResult.response
      })
    })

    if (!sendResult.ok) {
      return { success: false, error: 'Failed to send SMS' }
    }

    // Record the message in database with follow-up tracking
    await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        body: aiResult.response,
        direction: 'outbound',
        is_followup: true,
        followup_stage: stage,
        tokens_used: aiResult.tokensUsed,
        processing_time_ms: aiResult.processingTime,
        ai_model: aiResult.model
      })

    return { success: true }
  } catch (error) {
    console.error('Error sending follow-up message:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Stop follow-ups for a conversation (STOP keyword detected)
 */
export async function stopFollowups(conversationId, scenarioId) {
  try {
    const now = new Date()

    const { error } = await supabaseAdmin
      .from('conversation_followup_state')
      .update({
        stopped: true,
        stopped_at: now.toISOString(),
        next_followup_at: null,
        updated_at: now.toISOString()
      })
      .eq('conversation_id', conversationId)
      .eq('scenario_id', scenarioId)

    if (error) {
      console.error('Error stopping follow-ups:', error)
      return { success: false, error: error.message }
    }

    console.log(`Follow-ups stopped for conversation ${conversationId}`)
    return { success: true }
  } catch (error) {
    console.error('Error in stopFollowups:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Toggle manual override for a conversation
 */
export async function toggleManualOverride(conversationId, enabled) {
  try {
    const updates = {
      manual_override: enabled
    }

    if (enabled) {
      updates.last_manual_message_at = new Date().toISOString()
    }

    const { error } = await supabaseAdmin
      .from('conversations')
      .update(updates)
      .eq('id', conversationId)

    if (error) {
      console.error('Error toggling manual override:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in toggleManualOverride:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Add label to conversation
 */
export async function addConversationLabel(conversationId, label) {
  try {
    // Get current labels
    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('labels')
      .eq('id', conversationId)
      .single()

    const currentLabels = conversation?.labels || []

    // Add label if not already present
    if (!currentLabels.includes(label)) {
      const { error } = await supabaseAdmin
        .from('conversations')
        .update({
          labels: [...currentLabels, label]
        })
        .eq('id', conversationId)

      if (error) {
        return { success: false, error: error.message }
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error adding conversation label:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Remove label from conversation
 */
export async function removeConversationLabel(conversationId, label) {
  try {
    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('labels')
      .eq('id', conversationId)
      .single()

    const currentLabels = conversation?.labels || []
    const updatedLabels = currentLabels.filter(l => l !== label)

    const { error } = await supabaseAdmin
      .from('conversations')
      .update({
        labels: updatedLabels
      })
      .eq('id', conversationId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Error removing conversation label:', error)
    return { success: false, error: error.message }
  }
}
