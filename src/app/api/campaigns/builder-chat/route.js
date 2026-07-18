// POST /api/campaigns/builder-chat — the AI message writer for the campaign
// builder. Like the scenario builder it is NARROW: the model only writes/revises
// the campaign NAME + outbound MESSAGE from the user's description. Sender line,
// audience, filters, schedule and pace are deterministic UI steps.
//
// Unlike the scenario builder (which hardcodes gpt-4o), this routes to the
// USER-PICKED model (model picker is the first step of the campaign builder).
//
// Body:  { messages: [{role,content}], current: { name?, message? }, model?: <model id> }
// Reply: { success, reply, name, message, settings }

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import openai from '@/lib/openai'
import { listModels, getAIReply } from '@/lib/ai-models'

const MAX_TURNS = 30

const SYSTEM = `You write and revise the OPENING SMS MESSAGE for an outbound marketing/outreach campaign inside AiroPhone. A campaign sends ONE first text to many recipients at once (unlike AI "scenarios", which only REPLY to incoming texts). The user describes the offer / goal / audience, or asks for changes to the current draft.

Return ONLY a JSON object: {"reply": string, "name": string, "message": string, "settings": object}

- "message": the SMS body to send. Under 300 characters, friendly and human, ONE clear call to action, plain text (no markdown). Personalize with placeholders in {curly braces} — default to {first_name}. Weave in every concrete detail the user gives (offer, address, date/time, link, price). Never say you are an AI. Add an opt-out cue (e.g. "Reply STOP to opt out") only if the user asks.
- "name": a short campaign title you invent (never ask for one).
- "reply": ONE short friendly sentence about what you wrote or changed (e.g. "Done — shortened it and added the address."). No markdown, never repeat the message in the reply (the app shows it).
- On revision requests, return the FULL updated message, not a diff. Keep what wasn't asked to change.
- "settings": ONLY values the user EXPLICITLY stated anywhere in the conversation (omit the rest — the app asks). Possible keys:
  - "sender_number_id": id from AVAILABLE PHONE LINES when the user names the sending line.
  - "source": "contacts" | "monday" | "sheets" when they say where the audience comes from.
  - "contact_list_ids": array of ids from AVAILABLE CONTACT LISTS when they name lists.
  - "engagement": "all" | "not_replied" | "not_replied_recent" | "replied" | "never_messaged" when they describe who to include.`

const ENGAGEMENTS = new Set(['all', 'not_replied', 'not_replied_recent', 'replied', 'never_messaged'])

function parseJson(text) {
  if (!text) return null
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  const raw = fenced ? fenced[1] : text
  try { return JSON.parse(raw) } catch {}
  const m = String(raw).match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

// Author a JSON turn with the picked model. OpenAI models use JSON mode for
// reliability; Claude/Gemini are instructed to return JSON and parsed
// defensively; anything unavailable falls back to gpt-4o.
async function authorTurn({ modelId, chatMessages, contextMessage, current }) {
  const picked = listModels().find(m => m.id === modelId && m.available)

  if (!picked || picked.provider === 'openai') {
    const model = picked?.provider === 'openai' ? picked.id : 'gpt-4o'
    const completion = await openai.chat.completions.create({
      model, temperature: 0.6, max_tokens: 900, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'system', content: contextMessage },
        ...(current.message ? [{ role: 'system', content: `CURRENT DRAFT — name: ${current.name || '(none)'}\nmessage:\n${current.message}` }] : []),
        ...chatMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
      ],
    })
    return completion.choices?.[0]?.message?.content || ''
  }

  // Claude / Gemini via the shared router (history is SMS-shaped {direction, body}).
  const sys = `${SYSTEM}\n\n${contextMessage}${current.message ? `\n\nCURRENT DRAFT — name: ${current.name || '(none)'}\nmessage:\n${current.message}` : ''}\n\nReturn ONLY the JSON object — no prose, no code fences.`
  const history = chatMessages.map(m => ({ direction: m.role === 'assistant' ? 'outbound' : 'inbound', body: String(m.content || '').slice(0, 4000) }))
  const r = await getAIReply(modelId, history, sys)
  return r?.response || ''
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : []
  const current = body.current || {}
  const modelId = typeof body.model === 'string' ? body.model : null
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'messages must end with a user message' }, { status: 400 })
  }

  const [{ data: phones }, { data: lists }] = await Promise.all([
    supabaseAdmin.from('phone_numbers').select('id, phone_number, custom_name')
      .eq('workspace_id', user.workspaceId).eq('is_active', true),
    supabaseAdmin.from('contact_lists').select('id, name')
      .eq('workspace_id', user.workspaceId).limit(200),
  ])
  const phoneIds = new Set((phones || []).map(p => String(p.id)))
  const listIds = new Set((lists || []).map(l => String(l.id)))

  const contextMessage =
    `AVAILABLE PHONE LINES: ${JSON.stringify((phones || []).map(p => ({ id: String(p.id), label: p.custom_name ? `${p.custom_name} (${p.phone_number})` : p.phone_number })))}\n` +
    `AVAILABLE CONTACT LISTS: ${JSON.stringify((lists || []).map(l => ({ id: String(l.id), label: l.name })))}`

  try {
    const rawText = await authorTurn({ modelId, chatMessages: messages, contextMessage, current })
    const parsed = parseJson(rawText)

    if (!parsed || typeof parsed.message !== 'string' || !parsed.message.trim()) {
      return NextResponse.json({
        success: true,
        reply: "Sorry — I couldn't apply that. Try rephrasing?",
        name: current.name || '',
        message: current.message || '',
        settings: {},
      })
    }

    const raw = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    const settings = {}
    if (typeof raw.sender_number_id === 'string' && phoneIds.has(raw.sender_number_id)) settings.sender_number_id = raw.sender_number_id
    if (raw.source === 'contacts' || raw.source === 'monday' || raw.source === 'sheets') settings.source = raw.source
    if (Array.isArray(raw.contact_list_ids)) {
      const ids = raw.contact_list_ids.map(String).filter(id => listIds.has(id))
      if (ids.length) settings.contact_list_ids = ids
    }
    if (typeof raw.engagement === 'string' && ENGAGEMENTS.has(raw.engagement)) settings.engagement = raw.engagement

    return NextResponse.json({
      success: true,
      reply: String(parsed.reply || 'Done — message updated.'),
      name: String(parsed.name || current.name || 'New campaign').slice(0, 120),
      message: parsed.message.trim().slice(0, 1200),
      settings,
    })
  } catch (err) {
    console.error('[campaigns/builder-chat] error:', err)
    return NextResponse.json({ error: 'The assistant could not respond. Try again.' }, { status: 502 })
  }
}
