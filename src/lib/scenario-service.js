import { supabaseAdmin } from '@/lib/supabase-server'
import { getAIResponse } from '@/lib/openai'
import telnyx from '@/lib/telnyx'
import { getWorkspaceMessageRate } from '@/lib/pricing'
import {
  updateFollowupState,
  scheduleNextFollowup,
  addConversationLabel,
  toggleManualOverride
} from '@/lib/followup-service'

// Strip out automated/transactional messages (OTP codes, verification SMS,
// shipping alerts, etc.) so they don't pollute the AI's conversation context.
// These messages share the same phone number as a real conversation but have
// nothing to do with the scenario the AI is supposed to engage with.
const AUTOMATED_PATTERNS = [
  /verification code/i,
  /\bverify\b.*\bcode\b/i,
  /\bone[\s-]?time\b.*\bcode\b/i,
  /\bOTP\b/i,
  /your .* code is\b/i,
  /your code is\b/i,
  /^\s*\d{4,8}\s*(is your)?/i,           // "1234 is your" / bare "123456"
  /do not (share|reply)/i,
  /this code (will )?expires?/i,
  /\bvalid for \d+ (min|hour)/i,
  /^STOP/i,                                // STOP carrier auto-replies
  /reply (STOP|HELP)/i,
]

function isAutomatedMessage(body) {
  if (!body) return false
  const s = String(body).trim()
  if (s.length < 6) return false
  return AUTOMATED_PATTERNS.some(rx => rx.test(s))
}

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
          restrict_to_contact_lists,
          ai_reply_mode,
          books_appointments
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

// ── Business-hours prompt helpers ───────────────────────────────────────────
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// [1,2,3,4,5] → "Monday–Friday"; non-contiguous → "Monday, Wednesday, Friday".
function summarizeDays(days) {
  const d = [...new Set(days)].filter(n => n >= 1 && n <= 7).sort((a, b) => a - b)
  if (!d.length) return 'Monday–Friday'
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1)
  return contiguous && d.length > 1 ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d[d.length - 1]]}` : d.map(n => DAY_NAMES[n]).join(', ')
}
// "09:00:00" → "9:00 AM" (the stored time is wall-clock in the business tz).
function fmtBizTime(t) {
  const [h, m] = String(t || '09:00:00').split(':').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })
    .format(new Date(Date.UTC(2000, 0, 1, h || 0, m || 0)))
}
// Short tz label (EDT/EST/PST…) for a timezone, DST-correct for "now".
function tzShort(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz
  } catch { return tz }
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
    // Business hours: the AI ENGAGES whenever a lead replies — at any hour
    // (Option B). We do NOT skip out-of-hours messages; the BUSINESS HOURS block
    // injected into the prompt (below) constrains it to only offer/confirm
    // appointment slots inside business hours. So a lead replying at midnight
    // still gets an immediate reply, but the booking lands in business hours.

    // Get conversation history
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('messages')
      .select('id, direction, body, from_number, to_number, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })

    if (messagesError) {
      throw new Error(`Failed to fetch conversation history: ${messagesError.message}`)
    }

    // Format conversation history for AI — filter out OTP / verification / carrier
    // automated noise so the model isn't trying to reconcile "Your X code is 1234"
    // as part of the real conversation.
    const filteredMessages = messages.filter(m => {
      // Keep all outbound (our AI's prior replies) for context continuity
      if (m.direction === 'outbound') return true
      return !isAutomatedMessage(m.body)
    })
    const droppedCount = messages.length - filteredMessages.length
    if (droppedCount > 0) {
      console.log(`[scenario] Filtered ${droppedCount} automated message(s) from history`)
    }

    const conversationHistory = filteredMessages.map(msg => ({
      direction: msg.direction,
      body: msg.body,
      from: msg.from_number,
      to: msg.to_number,
      timestamp: msg.created_at
    }))

    executionLog.conversation_history = conversationHistory

    // Look up the contact and substitute {{key}} tokens in instructions.
    // A phone can exist in multiple lists (each as its own contacts row), and
    // older rows might be missing the custom fields the user added later. We
    // prefer the row that's actually in this scenario's restricted lists; if
    // none match (or scenario is unrestricted), pick the row with the most
    // populated custom_fields so we don't get stuck on an empty older entry.
    let instructions = scenario.instructions
    const { data: allMatches, error: contactLookupError } = await supabaseAdmin
      .from('contacts')
      .select('id, first_name, last_name, business_name, phone_number, email, city, state, country, custom_fields, contact_list_id, updated_at')
      .eq('workspace_id', scenario.workspace_id)
      .eq('phone_number', message.from_number)

    if (contactLookupError) {
      console.error('Error looking up contact for substitution:', contactLookupError.message)
    }

    const restrictedListIds = Array.isArray(scenario.restrict_to_contact_lists) ? scenario.restrict_to_contact_lists : []
    let contactRecord = null
    if (allMatches?.length) {
      // Prefer contacts in the scenario's allowed lists
      const inAllowedList = restrictedListIds.length
        ? allMatches.filter(c => restrictedListIds.includes(c.contact_list_id))
        : allMatches
      const pool = inAllowedList.length ? inAllowedList : allMatches
      // Of those, pick the one with the most populated custom_fields keys
      contactRecord = pool.reduce((best, cur) => {
        const score = (cur.custom_fields && !Array.isArray(cur.custom_fields))
          ? Object.values(cur.custom_fields).filter(v => v !== null && v !== '').length
          : 0
        const bestScore = (best.custom_fields && !Array.isArray(best.custom_fields))
          ? Object.values(best.custom_fields).filter(v => v !== null && v !== '').length
          : -1
        return score > bestScore ? cur : best
      }, pool[0])
      console.log(`[scenario] Contact lookup for ${message.from_number}: ${allMatches.length} row(s), picked id=${contactRecord.id} (list=${contactRecord.contact_list_id})`)
    }

    // Defensive: ContactPanel.js historically stored custom_fields as an array
    // of {id,label,type,value} — coerce to {key:value} so {{tokens}} resolve.
    const customFields = normalizeCustomFields(contactRecord?.custom_fields)

    // Build substitution table. Each key is also indexed under its lowercase
    // form so {{States}}, {{STATES}}, and {{states}} all resolve identically —
    // common source of confusion when a CSV header has different casing.
    const rawSubs = contactRecord ? {
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
    const substitutions = {}
    for (const [k, v] of Object.entries(rawSubs)) {
      substitutions[k] = v
      substitutions[k.toLowerCase()] = v
    }

    // Substitute known tags; remove unknown ones so AI doesn't see raw {{placeholders}}.
    // Track unresolved tokens so we can warn — broken-sentence instructions
    // ("I am buying in .") confuse the AI and produce off-script replies.
    const unresolvedTokens = new Set()
    const resolvedTokens = new Set()
    instructions = instructions.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      // Try exact, then lowercase
      let val = substitutions[key]
      if (val === undefined || val === '' || val === null) val = substitutions[key.toLowerCase()]
      if (val === undefined || val === '' || val === null) {
        unresolvedTokens.add(key)
        return ''
      }
      resolvedTokens.add(key)
      return String(val)
    })

    console.log('[scenario] Substitution debug', {
      sender: message.from_number,
      contact_found: !!contactRecord,
      contact_id: contactRecord?.id || null,
      contact_list_id: contactRecord?.contact_list_id || null,
      available_custom_keys: Object.keys(customFields),
      resolved: [...resolvedTokens],
      unresolved: [...unresolvedTokens],
    })

    if (unresolvedTokens.size > 0) {
      console.warn(`[scenario] Unresolved tokens for ${message.from_number}: ${[...unresolvedTokens].join(', ')} — message will read awkwardly. Check that this contact's custom_fields contains those keys.`)
    }

    // Pull the workspace's configured business hours (Settings → Business Hours)
    // so the AI's clock AND its scheduling window come from one place — no need
    // to hard-code times in the prompt.
    let bizTz = 'America/New_York'
    let businessHoursLine = ''
    try {
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('business_hours_start, business_hours_end, business_hours_tz, business_days')
        .eq('id', conversation.workspace_id)
        .maybeSingle()
      if (ws) {
        bizTz = ws.business_hours_tz || bizTz
        // Only inject the booking constraint for scenarios that actually BOOK
        // calls. An info/support scenario shouldn't be told to confirm callbacks.
        if (scenario.books_appointments !== false) {
          const bdays = ws.business_days && ws.business_days.length ? ws.business_days : [1, 2, 3, 4, 5]
          const days = summarizeDays(bdays)
          // Spell out the NEXT few days as open/closed so the AI never has to do
          // weekday math (the recurring "tried to book Saturday" bug). It just
          // picks an (open) day.
          const _ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
          const upcoming = []
          for (let i = 1; i <= 5; i++) {
            const p = new Intl.DateTimeFormat('en-US', { timeZone: bizTz, weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(new Date(Date.now() + i * 86400000))
            const wd = p.find(x => x.type === 'weekday')?.value
            const md = `${p.find(x => x.type === 'month')?.value} ${p.find(x => x.type === 'day')?.value}`
            upcoming.push(`${wd} ${md} ${bdays.includes(_ISO[wd]) ? '(open)' : '(CLOSED)'}`)
          }
          businessHoursLine = `\n\nBUSINESS HOURS: ${days}, ${fmtBizTime(ws.business_hours_start)}–${fmtBizTime(ws.business_hours_end)} (${tzShort(bizTz)}). Only confirm a callback INSIDE these hours and ONLY on a business day.` +
            `\nUPCOMING DAYS: ${upcoming.join(', ')}. Propose or confirm a callback ONLY on an (open) day — never on a (CLOSED) day. If the lead asks for a closed day or a time outside hours, guide them to the next (open) day at opening time.`
        }
      }
    } catch (e) { console.warn('[scenario] business hours load failed:', e.message) }

    // Current date/time in the business timezone — the AI has no built-in clock,
    // so without this it can't reason about "today/tomorrow/this afternoon" or
    // whether a requested time falls inside business hours.
    const nowLocal = new Intl.DateTimeFormat('en-US', {
      timeZone: bizTz,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date())

    // Build AI prompt
    const aiPrompt = `${instructions}

CURRENT DATE & TIME: ${nowLocal}.
Use this to interpret relative times the customer mentions (e.g. "today", "tomorrow", "this afternoon", "next week") and when confirming or proposing times.${businessHoursLine}

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

    // Supersede guard — the fix for "the bot replied 3 times / contradicted
    // itself." If the lead sent a NEWER inbound while we were generating the
    // reply and waiting out the humanizing delay, abort: a fresh execution
    // triggered by that newer message will reply with the FULL context. Without
    // this, a multi-text burst ("Tomorrow", "Or right now") spawns concurrent
    // runs that each send their own reply, none aware of the others.
    const { data: newerInbound } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('direction', 'inbound')
      .gt('created_at', message.created_at)
      .limit(1)
    if (newerInbound && newerInbound.length > 0) {
      console.log(`[scenario] reply superseded by a newer inbound in ${conversation.id} — skipping to avoid a duplicate/contradictory message`)
      executionLog.execution_status = 'skipped_superseded'
      executionLog.processing_time_ms = Date.now() - startTime
      await logScenarioExecution(executionLog)
      return { success: true, skipped: true, reason: 'superseded' }
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
