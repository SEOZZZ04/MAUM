const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const MODEL = 'gpt-4o-mini'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number; json_mode?: boolean } = {}
): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다')
  }

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
    throw new Error(`OpenAI API error (${res.status}): ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.choices?.[0]?.message?.content) {
    throw new Error('OpenAI 응답이 비어있습니다')
  }
  return data.choices[0].message.content
}

export async function chatCompletionJSON<T = unknown>(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {}
): Promise<T> {
  const content = await chatCompletion(messages, { ...options, json_mode: true })
  try {
    return JSON.parse(content)
  } catch {
    throw new Error(`OpenAI JSON 파싱 실패: ${content.slice(0, 100)}`)
  }
}
