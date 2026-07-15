// POST /api/scenarios/builder-chat — the AI prompt writer for the scenario
// builder (Step 1 of the wizard). Deliberately NARROW: the model only writes
// or revises the scenario NAME + INSTRUCTIONS from the user's description /
// change requests. All other settings (line, lists, follow-ups, keywords,
// hours, model) are deterministic UI steps — the model never orchestrates UI.
//
// Body:  { messages: [{role:'user'|'assistant', content}], current: { name?, instructions? } }
// Reply: { success, reply, name, instructions }

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import openai from '@/lib/openai'
import { listModels } from '@/lib/ai-models'

const MAX_TURNS = 30

const SYSTEM = `You write and revise prompts for SMS "AI scenarios" inside AiroPhone. An AI scenario REPLIES to incoming texts from leads on a business phone line — it never sends the first message (campaigns/automations do that). The user describes their business/goal, or asks for changes to the current draft.

Return ONLY a JSON object: {"reply": string, "name": string, "instructions": string, "settings": object}

- "instructions": the complete agent prompt, 150-300 words, plain text. Always include: who the agent is (persona/company voice), what's being offered, the goal of the conversation (e.g. book a call, qualify, answer questions), how to handle common questions and objections, and tone rules: never say you're an AI, keep replies 1-3 sentences, one question at a time, casual texting cadence, low pressure, stop pushing after a clear no. Weave in every concrete detail the user gives (company name, links, pricing, hours, offers).
- "name": a short scenario title you invent (never ask for one).
- "reply": ONE short friendly sentence about what you wrote or changed (e.g. "Done — I made the tone more casual."). No markdown, never repeat the prompt in the reply (the app displays it), no questions unless the user's request was truly impossible to act on.
- On revision requests, return the FULL updated instructions, not a diff. Keep everything that wasn't asked to change.
- NOT EVERY MESSAGE IS A DESCRIPTION. If the message is a greeting, small talk, a question about the tool, or too vague to describe an agent ("hi", "hello", "what can you do?", "test"), do NOT invent a scenario. Return {"reply": <one friendly line asking what their AI should do when leads text back, with a short example>, "name": "", "instructions": "", "settings": {}} — unless a draft already exists (CURRENT DRAFT present), in which case just answer conversationally in "reply" and return the current name/instructions unchanged.
- INFORMATIONAL QUESTIONS ("what contact lists do I have?", "which lines are there?", "what models can I use?"): answer factually IN "reply" by enumerating EVERY item from the AVAILABLE lists, one per line ("• Flexbox\n• Deelmap Test 3\n…"). The reply-length rule does not apply here — list them ALL, never summarize with "and more" or "several others", and NEVER say "here's a list" without the actual names (the app renders nothing for you).
- KNOW YOUR LIMITS: you only know the NAMES of contact lists — not the contacts/numbers inside them. If asked what's inside a list ("what numbers are in X?", "who's on that list?"), say plainly that you can't view a list's members from here and that they can open the Contacts page to see them — then offer what you CAN do (e.g. restrict the scenario to that list). Never answer a question you don't have the data for by restating something else.
- CHANGE REQUESTS ("change the line to Minnesota", "turn off follow-ups"): put the new value in "settings" AND confirm in "reply". Only claim something was changed if you actually returned it in "settings" (or updated name/instructions). If you can't map the request to a real item, say so and name the valid options instead.
- "settings": ONLY the setup values the user EXPLICITLY stated anywhere in the conversation — the app asks about the rest itself, so NEVER guess or fill defaults here. Possible keys (omit any the user didn't state):
  - "phone_number_ids": array of ids matched from AVAILABLE PHONE LINES when the user names a line ("on my California line").
  - "contact_list_ids": array of ids matched from AVAILABLE CONTACT LISTS when the user names lists; [] if they explicitly say everyone/anyone can text.
  - "enable_followups": boolean, and "max_followup_attempts": 1-10, when the user mentions following up N times / no follow-ups.
  - "auto_stop_keywords": array of uppercase words when the user lists opt-out words.
  - "ai_reply_mode": "anytime" | "business_hours" when the user says when it should reply.
  - "books_appointments": boolean when the goal clearly is/isn't booking a call or appointment.
  - "ai_model": an id from AVAILABLE AI MODELS when the user names a model/vendor ("use Claude").`

// Best-effort transcript persistence: store the latest user turn + the reply
// on the chat (never blocks or fails the response).
async function persistTurn(workspaceId, chatId, userText, replyText) {
  if (!chatId) return
  try {
    const { data: chat } = await supabaseAdmin
      .from('scenario_builder_chats')
      .select('id')
      .eq('id', chatId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!chat) return
    await supabaseAdmin.from('scenario_builder_messages').insert([
      { chat_id: chatId, role: 'user', content: String(userText || '').slice(0, 8000) },
      { chat_id: chatId, role: 'assistant', content: String(replyText || '').slice(0, 8000) },
    ])
    await supabaseAdmin.from('scenario_builder_chats')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId)
  } catch (e) { console.warn('[builder-chat] persist failed:', e.message) }
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : []
  const current = body.current || {}
  const chatId = body.chat_id || null
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'messages must end with a user message' }, { status: 400 })
  }

  // Workspace context so the model can MATCH explicitly-named lines/lists/models.
  const [{ data: phones }, { data: lists }] = await Promise.all([
    supabaseAdmin.from('phone_numbers').select('id, phone_number, custom_name')
      .eq('workspace_id', user.workspaceId).eq('is_active', true),
    supabaseAdmin.from('contact_lists').select('id, name')
      .eq('workspace_id', user.workspaceId).limit(200),
  ])
  const phoneIds = new Set((phones || []).map(p => String(p.id)))
  const listIds = new Set((lists || []).map(l => String(l.id)))
  const modelIds = new Set(listModels().filter(m => m.available).map(m => m.id))

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.5,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'system', content:
          `AVAILABLE PHONE LINES: ${JSON.stringify((phones || []).map(p => ({ id: String(p.id), label: p.custom_name ? `${p.custom_name} (${p.phone_number})` : p.phone_number })))}\n` +
          `AVAILABLE CONTACT LISTS: ${JSON.stringify((lists || []).map(l => ({ id: String(l.id), label: l.name })))}\n` +
          `AVAILABLE AI MODELS: ${JSON.stringify(listModels().filter(m => m.available).map(m => ({ id: m.id, label: `${m.vendor} ${m.label}` })))}` },
        ...(current.instructions
          ? [{ role: 'system', content: `CURRENT DRAFT — name: ${current.name || '(none)'}\ninstructions:\n${current.instructions}` }]
          : []),
        ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
      ],
    })

    let parsed = null
    try { parsed = JSON.parse(completion.choices[0].message.content) } catch {}

    // Parse failure → keep the previous draft, never leak plumbing.
    if (!parsed) {
      return NextResponse.json({
        success: true,
        reply: "Sorry — I couldn't apply that. Try rephrasing?",
        name: current.name || '',
        instructions: current.instructions || '',
        settings: {},
      })
    }

    // Deliberately-empty instructions = the message wasn't a scenario
    // description ("hi", "what is this?") — pass the conversational reply
    // through with NO draft so the UI doesn't render a prompt card.
    if (typeof parsed.instructions !== 'string' || !parsed.instructions.trim()) {
      const reply = String(parsed.reply || "Tell me what your AI should do when leads text back — e.g. “answer questions about my roofing service and book an estimate”.")
      await persistTurn(user.workspaceId, chatId, messages[messages.length - 1].content, reply)
      return NextResponse.json({
        success: true,
        reply,
        name: current.name || '',
        instructions: current.instructions || '',
        settings: {},
      })
    }

    // Validate extracted settings server-side: drop unknown ids and bad types
    // so a hallucinated match can never reach the UI.
    const raw = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    const settings = {}
    if (Array.isArray(raw.phone_number_ids)) {
      const ids = raw.phone_number_ids.map(String).filter(id => phoneIds.has(id))
      if (ids.length) settings.phone_number_ids = ids
    }
    if (Array.isArray(raw.contact_list_ids)) {
      const ids = raw.contact_list_ids.map(String).filter(id => listIds.has(id))
      if (ids.length || raw.contact_list_ids.length === 0) settings.contact_list_ids = ids
    }
    if (typeof raw.enable_followups === 'boolean') settings.enable_followups = raw.enable_followups
    if (Number.isFinite(Number(raw.max_followup_attempts))) {
      settings.max_followup_attempts = Math.min(10, Math.max(1, Math.floor(Number(raw.max_followup_attempts))))
    }
    if (Array.isArray(raw.auto_stop_keywords)) {
      const words = raw.auto_stop_keywords.map(w => String(w).toUpperCase().trim()).filter(Boolean)
      if (words.length) settings.auto_stop_keywords = [...new Set(words)]
    }
    if (raw.ai_reply_mode === 'anytime' || raw.ai_reply_mode === 'business_hours') settings.ai_reply_mode = raw.ai_reply_mode
    if (typeof raw.books_appointments === 'boolean') settings.books_appointments = raw.books_appointments
    if (typeof raw.ai_model === 'string' && modelIds.has(raw.ai_model)) settings.ai_model = raw.ai_model

    const reply = String(parsed.reply || 'Done — draft updated.')
    await persistTurn(user.workspaceId, chatId, messages[messages.length - 1].content, reply)
    return NextResponse.json({
      success: true,
      reply,
      name: String(parsed.name || current.name || 'New scenario').slice(0, 120),
      instructions: parsed.instructions.trim(),
      settings,
    })
  } catch (err) {
    console.error('[builder-chat] error:', err)
    return NextResponse.json({ error: 'The assistant could not respond. Try again.' }, { status: 502 })
  }
}
