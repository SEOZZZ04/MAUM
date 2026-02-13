import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { chatCompletion } from '../_shared/openai.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { day_id } = await req.json()
    if (!day_id) throw new Error('day_id required')

    // Get messages for the day
    const { data: messages } = await supabase
      .from('messages')
      .select('text, sender_user_id')
      .eq('day_id', day_id)
      .order('created_at', { ascending: true })
      .limit(50)

    if (!messages?.length) throw new Error('메시지가 없습니다')

    const conversation = messages.map(m => m.text).join('\n')

    const title = await chatCompletion([
      {
        role: 'system',
        content: '당신은 커플 대화의 제목을 만드는 도우미입니다. 대화 내용을 읽고 재치있고 따뜻한 한국어 제목을 한 줄(20자 이내)로 만들어주세요. 제목만 출력하세요.'
      },
      { role: 'user', content: conversation }
    ], { temperature: 0.9, max_tokens: 50 })

    // Update day title
    await supabase
      .from('conversation_days')
      .update({ title: title.trim() })
      .eq('id', day_id)

    return new Response(JSON.stringify({ title: title.trim() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
