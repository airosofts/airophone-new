// POST /api/ai/summarize-conversation  { conversationId }
// Summarizes a conversation thread with Groq (fast LLM) for a real-estate
// acquisitions agent: what the lead wants, sentiment, and the next step.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_MESSAGES = 120   // cap the transcript we send

export async function POST(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: 'AI summary is not configured' }, { status: 503 })
  }

  const { conversationId } = await request.json().catch(() => ({}))
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  // Confirm the conversation belongs to this workspace, then pull the thread.
  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id, name, phone_number, workspace_id')
    .eq('id', conversationId)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()
  if (!convo) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('direction, body, type, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MAX_MESSAGES)

  const lines = (messages || [])
    .map(m => {
      const who = m.direction === 'inbound' ? 'Lead' : 'Us'
      const text = m.type === 'voicemail' ? '[voicemail]'
        : (m.body || '').replace(/\s+/g, ' ').trim()
      return text ? `${who}: ${text}` : null
    })
    .filter(Boolean)

  if (lines.length === 0) {
    return NextResponse.json({ summary: 'No messages to summarize yet.' })
  }

  const contactLabel = convo.name || convo.phone_number || 'the lead'
  const system = 'You summarize SMS conversations for a real-estate acquisitions agent. Be concise and factual — no fluff, no preamble. Use short markdown bullets. Cover: where the conversation stands, what the lead wants (price/timeline/property if mentioned), their sentiment/interest level, and the single best next step. If something is unknown, omit it rather than guessing.'
  const user = `Conversation with ${contactLabel}. Transcript (oldest → newest):\n\n${lines.join('\n')}`

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[ai:summary] groq error:', data)
      return NextResponse.json({ error: data?.error?.message || 'Summary failed' }, { status: 502 })
    }
    const summary = data?.choices?.[0]?.message?.content?.trim() || 'Could not generate a summary.'
    return NextResponse.json({ summary, model: GROQ_MODEL, messageCount: lines.length })
  } catch (err) {
    console.error('[ai:summary] request failed:', err.message)
    return NextResponse.json({ error: 'Could not reach the summary service' }, { status: 502 })
  }
}
