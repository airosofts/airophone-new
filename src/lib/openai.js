import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // The SDK's bundled node-fetch@2 throws ERR_STREAM_PREMATURE_CLOSE when a
  // gzipped body arrives over a stale keep-alive socket; Node's native fetch
  // (undici) doesn't have that bug.
  fetch: (...args) => globalThis.fetch(...args),
  timeout: 60_000,
  maxRetries: 2,
})

// Body-read failures (Premature close, ECONNRESET) surface after headers are
// received, so the SDK's own retry doesn't cover them — retry here.
const RETRYABLE_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
])

function isRetryable(error) {
  return (
    RETRYABLE_CODES.has(error?.code) ||
    RETRYABLE_CODES.has(error?.cause?.code) ||
    error instanceof OpenAI.APIConnectionError
  )
}

export async function getAIResponse(conversationHistory, scenarioInstructions) {
  const startTime = Date.now()

  try {
    const messages = [
      {
        role: 'system',
        content: scenarioInstructions
      },
      ...conversationHistory.map(msg => ({
        role: msg.direction === 'inbound' ? 'user' : 'assistant',
        content: msg.body || ''
      }))
    ]

    let completion
    for (let attempt = 1; ; attempt++) {
      try {
        completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: messages,
          temperature: 0.7,
          max_tokens: 500,
        })
        break
      } catch (error) {
        if (attempt >= 3 || !isRetryable(error)) throw error
        console.warn(`OpenAI transient network error (attempt ${attempt}/3), retrying:`, error.code || error.message)
        await new Promise(resolve => setTimeout(resolve, 500 * attempt))
      }
    }

    const processingTime = Date.now() - startTime
    const response = completion.choices[0].message.content
    const tokensUsed = completion.usage?.total_tokens || 0

    return {
      success: true,
      response,
      processingTime,
      tokensUsed,
      model: completion.model
    }
  } catch (error) {
    console.error('OpenAI API Error:', error)
    return {
      success: false,
      error: error.message,
      processingTime: Date.now() - startTime
    }
  }
}

export default openai
