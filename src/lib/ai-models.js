// Bring-your-own-model for AI scenario replies. One registry + one router:
// getAIReply(modelId, history, systemPrompt) speaks to OpenAI, Anthropic or
// Google and returns the same shape getAIResponse always has:
//   { success, response, tokensUsed, model, processingTime } | { success:false, error }
//
// A model whose provider key isn't configured falls back to the OpenAI
// default at reply time — a missing key must never silence a lead.

import { getAIResponse } from '@/lib/openai'

export const AI_MODELS = [
  { id: 'gpt-4o-mini',                label: 'GPT-4o mini',   vendor: 'ChatGPT', provider: 'openai',    envKey: 'OPENAI_API_KEY',    isDefault: true },
  { id: 'gpt-4o',                     label: 'GPT-4o',        vendor: 'ChatGPT', provider: 'openai',    envKey: 'OPENAI_API_KEY' },
  { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku',  vendor: 'Claude',  provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY' },
  { id: 'claude-sonnet-5',            label: 'Claude Sonnet', vendor: 'Claude',  provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY' },
  { id: 'gemini-2.5-flash',           label: 'Gemini Flash',  vendor: 'Gemini',  provider: 'google',    envKey: 'GEMINI_API_KEY' },
]

export function listModels() {
  return AI_MODELS.map(m => ({
    id: m.id, label: m.label, vendor: m.vendor, provider: m.provider,
    isDefault: !!m.isDefault, available: !!process.env[m.envKey],
  }))
}

// Anthropic/Gemini require alternating roles starting with 'user'. Scenario
// history often starts with OUR outbound (campaign opener) and can have
// same-role bursts — normalize: merge consecutive same-role messages and
// prepend a neutral user turn when the first message is ours.
function normalizeTurns(history) {
  const turns = []
  for (const msg of history) {
    const role = msg.direction === 'inbound' ? 'user' : 'assistant'
    const text = msg.body || ''
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.text += `\n${text}`
    else turns.push({ role, text })
  }
  if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', text: '[Conversation start]' })
  if (turns.length === 0) turns.push({ role: 'user', text: '[Conversation start]' })
  return turns
}

async function anthropicReply(modelId, history, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 500,
      temperature: 0.7,
      system: systemPrompt,
      messages: normalizeTurns(history).map(t => ({ role: t.role, content: t.text })),
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic API error (${res.status})`)
  return {
    response: (json.content || []).map(b => b.text || '').join('').trim(),
    tokensUsed: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
    model: json.model || modelId,
  }
}

async function geminiReply(modelId, history, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${process.env.GEMINI_API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: normalizeTurns(history).map(t => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.text }],
      })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message || `Gemini API error (${res.status})`)
  const parts = json.candidates?.[0]?.content?.parts || []
  return {
    response: parts.map(p => p.text || '').join('').trim(),
    tokensUsed: json.usageMetadata?.totalTokenCount || 0,
    model: modelId,
  }
}

export async function getAIReply(modelId, conversationHistory, systemPrompt) {
  const startTime = Date.now()
  const entry = AI_MODELS.find(m => m.id === modelId)

  // Unknown model, no model chosen, or provider key missing → OpenAI default.
  if (!entry || !process.env[entry.envKey]) {
    if (entry && !process.env[entry.envKey]) {
      console.warn(`[ai-models] ${modelId} selected but ${entry.envKey} not set — falling back to OpenAI default`)
    }
    return getAIResponse(conversationHistory, systemPrompt)
  }
  if (entry.provider === 'openai') {
    return getAIResponse(conversationHistory, systemPrompt, { model: entry.id })
  }

  try {
    const fn = entry.provider === 'anthropic' ? anthropicReply : geminiReply
    const { response, tokensUsed, model } = await fn(entry.id, conversationHistory, systemPrompt)
    if (!response) throw new Error('Empty response from model')
    return { success: true, response, tokensUsed, model, processingTime: Date.now() - startTime }
  } catch (err) {
    console.error(`[ai-models] ${entry.provider} reply failed:`, err.message, '— falling back to OpenAI default')
    // Provider outage shouldn't drop the lead — answer with the default model.
    return getAIResponse(conversationHistory, systemPrompt)
  }
}
