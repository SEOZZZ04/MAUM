const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const MODEL = 'gpt-5-mini'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number; json_mode?: boolean } = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 2000,
  }

  if (options.json_mode) {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.choices[0].message.content
}

export async function chatCompletionJSON<T = unknown>(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {}
): Promise<T> {
  const content = await chatCompletion(messages, { ...options, json_mode: true })
  return JSON.parse(content)
}
