// Messages inside one sandbox test chat.
//   GET  → full transcript
//   POST { body } → store the tester's message (they play the LEAD), generate
//                   the AI's reply with the EXACT same prompt pipeline as the
//                   live webhook path, store and return it.
//
// Deliberately NOT done here (sandbox is simulation only): no Telnyx send, no
// credit deduction, no follow-up arming, no scenario_executions log, no reply
// delay. {{tokens}} are substituted with sample lead values; any token that
// can't be resolved is reported back so the user can fix their prompt.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'
import { getAIReply } from '@/lib/ai-models'
import { buildScenarioSystemPrompt } from '@/lib/scenario-service'

// Sample lead used for {{token}} substitution in tests.
const SAMPLE_LEAD = {
  first_name: 'John',
  last_name: 'Doe',
  business_name: 'Acme Roofing LLC',
  phone_number: '+15551234567',
  email: 'john@example.com',
  city: 'Austin',
  state: 'Texas',
  country: 'US',
}

async function loadOwnedSession(scenarioId, sessionId, workspaceId) {
  const { data: scenario } = await supabaseAdmin
    .from('scenarios')
    .select('id, workspace_id, name, instructions, books_appointments, ai_model')
    .eq('id', scenarioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!scenario) return {}

  const { data: session } = await supabaseAdmin
    .from('scenario_sandbox_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('scenario_id', scenarioId)
    .maybeSingle()
  return { scenario, session }
}

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: scenarioId, sessionId } = await params

  const { scenario, session } = await loadOwnedSession(scenarioId, sessionId, user.workspaceId)
  if (!scenario || !session) return NextResponse.json({ error: 'Test chat not found' }, { status: 404 })

  const { data: messages, error } = await supabaseAdmin
    .from('scenario_sandbox_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[sandbox messages GET] db error:', error)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
  return NextResponse.json({ messages: messages || [] })
}

export async function POST(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: scenarioId, sessionId } = await params

  const { scenario, session } = await loadOwnedSession(scenarioId, sessionId, user.workspaceId)
  if (!scenario || !session) return NextResponse.json({ error: 'Test chat not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const text = (body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  // Opener mode: the FIRST text of a real conversation is usually OURS (a
  // campaign template or automation opener) — the AI only speaks once the
  // lead replies. `opener: true` stores the pasted template as an outbound
  // message WITHOUT calling the AI, hydrating {{tokens}}/{tokens} with the
  // sample lead exactly like the campaign send loop would.
  if (body.opener) {
    const unresolved = []
    const hydrate = (m, key) => {
      const val = SAMPLE_LEAD[key] ?? SAMPLE_LEAD[key.toLowerCase()]
      if (val === undefined || val === null || val === '') { unresolved.push(key); return '' }
      return String(val)
    }
    const hydrated = text
      .replace(/\{\{(\w+)\}\}/g, hydrate)
      .replace(/\{(\w+)\}/g, hydrate)

    const { data: openerMsg, error: openerErr } = await supabaseAdmin
      .from('scenario_sandbox_messages')
      .insert({
        session_id: sessionId,
        direction: 'outbound',
        body: hydrated,
        meta: { opener: true, unresolved_tokens: [...new Set(unresolved)] },
      })
      .select()
      .single()
    if (openerErr) {
      console.error('[sandbox messages POST] opener insert error:', openerErr)
      return NextResponse.json({ error: 'Failed to save opening text' }, { status: 500 })
    }
    await supabaseAdmin
      .from('scenario_sandbox_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId)
    return NextResponse.json({ success: true, opener: openerMsg, unresolvedTokens: [...new Set(unresolved)] })
  }

  // 1) Store the tester's message (they are the lead → inbound).
  const { data: inMsg, error: inErr } = await supabaseAdmin
    .from('scenario_sandbox_messages')
    .insert({ session_id: sessionId, direction: 'inbound', body: text })
    .select()
    .single()
  if (inErr) {
    console.error('[sandbox messages POST] insert error:', inErr)
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }

  // 2) Substitute {{tokens}} with the sample lead, tracking unresolved ones —
  // same replace logic as executeScenario (unknown tokens become '').
  const unresolved = []
  const instructions = (scenario.instructions || '').replace(/\{\{(\w+)\}\}/g, (m, key) => {
    const val = SAMPLE_LEAD[key] ?? SAMPLE_LEAD[key.toLowerCase()]
    if (val === undefined || val === null || val === '') {
      unresolved.push(key)
      return ''
    }
    return String(val)
  })

  // 3) Build the prompt with the SHARED builder (business hours, date, rules).
  const aiPrompt = await buildScenarioSystemPrompt({
    instructions,
    booksAppointments: scenario.books_appointments,
    workspaceId: user.workspaceId,
  })

  // 4) Conversation history = this test chat's transcript (same shape the
  // live path feeds getAIResponse: {direction, body}).
  const { data: history } = await supabaseAdmin
    .from('scenario_sandbox_messages')
    .select('direction, body, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  const aiResult = await getAIReply(
    scenario.ai_model,
    (history || []).map(m => ({ direction: m.direction, body: m.body })),
    aiPrompt
  )

  if (!aiResult.success) {
    return NextResponse.json({
      success: false,
      error: `AI error: ${aiResult.error}`,
      message: inMsg,
    }, { status: 502 })
  }

  // 5) Interpret the same control sentinels as the live path.
  const stopped = aiResult.response.includes('STOP_SCENARIO')
  const humanNeeded = !stopped && (aiResult.response.includes('NEED_HUMAN') || aiResult.response.includes('HUMAN_NEEDED'))
  const meta = {
    stopped,
    human_needed: humanNeeded,
    unresolved_tokens: [...new Set(unresolved)],
  }

  // In the live flow a stopped scenario sends nothing, and NEED_HUMAN sends a
  // canned hand-off text. Mirror both so the tester sees real behavior.
  const replyBody = stopped
    ? null
    : humanNeeded
      ? 'Thank you for your patience. One of our team members will be with you shortly to assist with your request.'
      : aiResult.response

  let outMsg = null
  if (replyBody !== null) {
    const { data } = await supabaseAdmin
      .from('scenario_sandbox_messages')
      .insert({
        session_id: sessionId,
        direction: 'outbound',
        body: replyBody,
        tokens_used: aiResult.tokensUsed || null,
        processing_time_ms: aiResult.processingTime || null,
        meta,
      })
      .select()
      .single()
    outMsg = data
  } else {
    // Persist the stop as a zero-length marker so reloading the chat still
    // shows "the AI stopped here".
    const { data } = await supabaseAdmin
      .from('scenario_sandbox_messages')
      .insert({ session_id: sessionId, direction: 'outbound', body: '', meta })
      .select()
      .single()
    outMsg = data
  }

  await supabaseAdmin
    .from('scenario_sandbox_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return NextResponse.json({
    success: true,
    message: inMsg,
    reply: outMsg,
    stopped,
    humanNeeded,
    unresolvedTokens: meta.unresolved_tokens,
    tokensUsed: aiResult.tokensUsed || 0,
    processingTime: aiResult.processingTime || 0,
  })
}
