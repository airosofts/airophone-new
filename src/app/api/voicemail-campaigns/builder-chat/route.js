// POST /api/voicemail-campaigns/builder-chat — the AI writer for the ringless
// voicemail (RVM) builder. Sibling of /api/campaigns/builder-chat (kept separate;
// the SMS builder is untouched). RVM sends AUDIO, not text, so the model can't
// produce the deliverable itself — instead it writes the campaign NAME + a short
// VOICEMAIL SCRIPT the user reads aloud when recording. Sender line, audio,
// audience, filter, speed and schedule are deterministic UI steps.
//
// Routes to the USER-PICKED model (the picker is the first step of the builder).
//
// Body:  { messages: [{role,content}], current: { name?, script? }, model?: <model id> }
// Reply: { success, reply, name, script, settings }

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import openai from '@/lib/openai'
import { listModels, getAIReply } from '@/lib/ai-models'

const MAX_TURNS = 30

const SYSTEM = `You write and revise the SPOKEN SCRIPT for an outbound RINGLESS VOICEMAIL campaign inside AiroPhone. A ringless voicemail drops a pre-recorded audio message straight into many people's voicemail inboxes at once — their phone never rings. The user describes the offer / goal / audience, or asks for changes to the current draft. The user will RECORD or UPLOAD the audio themselves; your script is the words they read aloud.

Return ONLY a JSON object: {"reply": string, "name": string, "script": string, "settings": object}

- "script": the words to speak in the voicemail. Natural, warm, and CONVERSATIONAL — it is spoken, not read, so short sentences and a human tone. 15–30 seconds when read aloud (roughly 40–85 words). ONE clear call to action (usually "give me a call back at ..." or "text me back"). Plain text, no markdown, no stage directions, no placeholders/merge-fields (audio can't be personalized per person). Open by saying who is calling if the user gave a name/company. Never say you are an AI or a recording.
- "name": a short campaign title you invent (never ask for one).
- "reply": ONE short friendly sentence about what you wrote or changed (e.g. "Done — made it warmer and added your callback number."). No markdown, never repeat the script in the reply (the app shows it).
- On revision requests, return the FULL updated script, not a diff. Keep what wasn't asked to change.
- "settings": ONLY values the user EXPLICITLY stated anywhere in the conversation (omit the rest — the app asks). Possible keys:
  - "sender_number_id": id from AVAILABLE VOICEMAIL LINES when the user names the sending line.
  - "contact_list_ids": array of ids from AVAILABLE CONTACT LISTS when they name lists.`

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
        ...(current.script ? [{ role: 'system', content: `CURRENT DRAFT — name: ${current.name || '(none)'}\nscript:\n${current.script}` }] : []),
        ...chatMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
      ],
    })
    return completion.choices?.[0]?.message?.content || ''
  }

  // Claude / Gemini via the shared router (history is SMS-shaped {direction, body}).
  const sys = `${SYSTEM}\n\n${contextMessage}${current.script ? `\n\nCURRENT DRAFT — name: ${current.name || '(none)'}\nscript:\n${current.script}` : ''}\n\nReturn ONLY the JSON object — no prose, no code fences.`
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

  // Only voicemail-verified lines can send RVMs, so that's all the model sees.
  const [{ data: phones }, { data: lists }] = await Promise.all([
    supabaseAdmin.from('phone_numbers').select('id, phone_number, custom_name')
      .eq('workspace_id', user.workspaceId).eq('is_active', true).eq('voicedrop_verified', true),
    supabaseAdmin.from('contact_lists').select('id, name')
      .eq('workspace_id', user.workspaceId).limit(200),
  ])
  const phoneIds = new Set((phones || []).map(p => String(p.id)))
  const listIds = new Set((lists || []).map(l => String(l.id)))

  const contextMessage =
    `AVAILABLE VOICEMAIL LINES: ${JSON.stringify((phones || []).map(p => ({ id: String(p.id), label: p.custom_name ? `${p.custom_name} (${p.phone_number})` : p.phone_number })))}\n` +
    `AVAILABLE CONTACT LISTS: ${JSON.stringify((lists || []).map(l => ({ id: String(l.id), label: l.name })))}`

  try {
    const rawText = await authorTurn({ modelId, chatMessages: messages, contextMessage, current })
    const parsed = parseJson(rawText)

    if (!parsed || typeof parsed.script !== 'string' || !parsed.script.trim()) {
      return NextResponse.json({
        success: true,
        reply: "Sorry — I couldn't apply that. Try rephrasing?",
        name: current.name || '',
        script: current.script || '',
        settings: {},
      })
    }

    const raw = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    const settings = {}
    if (typeof raw.sender_number_id === 'string' && phoneIds.has(raw.sender_number_id)) settings.sender_number_id = raw.sender_number_id
    if (Array.isArray(raw.contact_list_ids)) {
      const ids = raw.contact_list_ids.map(String).filter(id => listIds.has(id))
      if (ids.length) settings.contact_list_ids = ids
    }

    return NextResponse.json({
      success: true,
      reply: String(parsed.reply || 'Done — script updated.'),
      name: String(parsed.name || current.name || 'New voicemail campaign').slice(0, 120),
      script: parsed.script.trim().slice(0, 1200),
      settings,
    })
  } catch (err) {
    console.error('[voicemail-campaigns/builder-chat] error:', err)
    return NextResponse.json({ error: 'The assistant could not respond. Try again.' }, { status: 502 })
  }
}
