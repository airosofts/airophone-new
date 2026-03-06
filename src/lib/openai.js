import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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
        content: msg.body
      }))
    ]

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
    })

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
