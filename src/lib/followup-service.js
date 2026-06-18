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

// ── Workspace business hours (Settings → Business Hours) — the same source the
// main scenario prompt uses, so follow-ups behave consistently. ──────────────
async function loadWorkspaceHours(workspaceId) {
  if (!workspaceId) return null
  const { data } = await supabaseAdmin
    .from('workspaces')
    .select('business_hours_start, business_hours_end, business_hours_tz, business_days')
    .eq('id', workspaceId).maybeSingle()
  if (!data) return null
  return {
    start: data.business_hours_start || '09:00:00',
    end: data.business_hours_end || '18:00:00',
    tz: data.business_hours_tz || 'America/New_York',
    days: (data.business_days && data.business_days.length) ? data.business_days : [1, 2, 3, 4, 5],
  }
}
const _DOW = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }   // ISO Mon=1..Sun=7
function isWithinWorkspaceHours(bh) {
  if (!bh) return true
  const p = new Intl.DateTimeFormat('en-US', { timeZone: bh.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  // Follow-ups run 7 days a week — only the HOUR window gates whether a nudge may
  // fire (per client spec: "the bot is active 7 days, it just schedules during
  // business hours, 8AM–10PM"). We intentionally do NOT restrict by business DAY
  // here; the weekday list only shapes what the AI proposes for callbacks
  // (see hoursPromptBlock), not whether today is eligible to send.
  const cur = Number(p.find(x => x.type === 'hour')?.value) * 60 + Number(p.find(x => x.type === 'minute')?.value)
  const [sh, sm] = bh.start.split(':').map(Number)
  const [eh, em] = bh.end.split(':').map(Number)
  return cur >= (sh * 60 + sm) && cur <= (eh * 60 + em)
}
const _DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
function hoursPromptBlock(bh) {
  if (!bh) return ''
  const now = new Intl.DateTimeFormat('en-US', { timeZone: bh.tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date())
  const d = [...new Set(bh.days)].sort((a, b) => a - b)
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1)
  const daysStr = contiguous && d.length > 1 ? `${_DAY[d[0]]}–${_DAY[d[d.length - 1]]}` : d.map(n => _DAY[n]).join(', ')
  const ft = (t) => { const [h, m] = String(t).split(':').map(Number); return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1, h, m))) }
  return `\n\nCURRENT DATE & TIME: ${now}.\nBUSINESS HOURS: ${daysStr}, ${ft(bh.start)}–${ft(bh.end)}. Only propose or confirm callbacks INSIDE these hours; for anything outside, guide to the next business day at opening.`
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

      // Standard cadence behavior: a reply EXITS the follow-up sequence. Cancel
      // any pending nudge, and stop the sequence — but only once it's actually
      // active (a nudge is pending or already sent), NOT on the first inbound
      // that merely starts the conversation (that one still needs to arm stage 1).
      if (messageFrom === 'customer') {
        updates.next_followup_at = null
        if (existingState.next_followup_at || (existingState.current_stage || 0) >= 1) {
          updates.stopped = true
          updates.stopped_at = now.toISOString()
        }
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
    if (unit === 'weeks') {
      nextFollowupAt.setDate(nextFollowupAt.getDate() + followupStage.wait_duration * 7)
    } else if (unit === 'days') {
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

    // Lines with AI auto-reply switched off — suppress their follow-ups too.
    const { data: offLines } = await supabaseAdmin
      .from('phone_numbers').select('phone_number').eq('ai_enabled', false)
    const aiOffLines = new Set((offLines || []).map(p => p.phone_number?.replace(/\D/g, '').slice(-10)).filter(Boolean))

    let processed = 0
    let skipped = 0

    for (const followupState of dueFollowups) {
      // While paused (human took over, or the line's AI is off) we RE-ANCHOR the
      // nudge a short, natural gap into the future instead of letting it pile up
      // overdue — so when AI/override is cleared it doesn't fire a stale message
      // the instant it resumes; it goes out shortly after, not immediately.
      const reAnchor = async () => {
        const t = new Date(Date.now() + 10 * 60 * 1000)   // +10 min
        await supabaseAdmin.from('conversation_followup_state')
          .update({ next_followup_at: t.toISOString() }).eq('id', followupState.id)
      }

      if (followupState.conversations?.manual_override) {
        console.log(`Re-anchoring follow-up for ${followupState.conversation_id} - manual override active`)
        await reAnchor(); skipped++; continue
      }
      const fromDigits = followupState.conversations?.from_number?.replace(/\D/g, '').slice(-10)
      if (fromDigits && aiOffLines.has(fromDigits)) {
        console.log(`Re-anchoring follow-up for ${followupState.conversation_id} - line AI disabled`)
        await reAnchor(); skipped++; continue
      }

      // RULE: follow up ONLY if the lead hasn't responded. If the last message
      // in the thread is from the lead, they're engaged — cancel the nudge so we
      // never talk over the live AI reply (and never send a stale next stage).
      const { data: lastMsg } = await supabaseAdmin
        .from('messages')
        .select('direction')
        .eq('conversation_id', followupState.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastMsg?.direction === 'inbound') {
        console.log(`Skipping follow-up for ${followupState.conversation_id} — lead has replied; cancelling pending nudge`)
        await supabaseAdmin
          .from('conversation_followup_state')
          .update({ next_followup_at: null, last_message_from: 'customer', updated_at: now.toISOString() })
          .eq('id', followupState.id)
        skipped++
        continue
      }

      // Follow-ups run 24/7 by DEFAULT. Only when this scenario has the
      // "Business Hours — Restrict AI to specific hours" toggle ON do we hold
      // sends to the Settings → Business Hours window. The hours come from
      // Settings (loadWorkspaceHours), never hardcoded, and apply every day
      // (7-day, hour-gated). `bh` is still loaded unconditionally so the AI's
      // callback-time suggestions stay sane (see hoursPromptBlock).
      const bh = await loadWorkspaceHours(followupState.scenarios?.workspace_id)
      const restrictToHours = !!followupState.scenarios?.enable_business_hours
      if (restrictToHours && !isWithinWorkspaceHours(bh)) {
        console.log(`Holding follow-up for ${followupState.conversation_id} - outside Settings business hours (restriction toggle on)`)
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
        nextStage,
        bh
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
async function sendFollowupMessage(conversationId, scenarioId, stageInstructions, scenarioInstructions, workspaceId, stage, bh = null) {
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

    // Generate AI response — append the current date/time + business-hours block
    // so a scheduling follow-up respects hours, exactly like the main scenario.
    const { getAIResponse } = await import('./openai')
    const aiResult = await getAIResponse(messages, combinedInstructions + hoursPromptBlock(bh))

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
