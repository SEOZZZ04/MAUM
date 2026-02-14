import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const admin = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { date } = await req.json()
    if (!date) throw new Error('date required')

    // Get couple
    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    // Get messages for date
    const { data: days } = await supabase
      .from('conversation_days')
      .select('id')
      .eq('couple_id', membership.couple_id)
      .eq('date', date)

    if (!days?.length) throw new Error('해당 날짜에 대화가 없습니다')

    const dayIds = days.map(d => d.id)
    const { data: messages } = await supabase
      .from('messages')
      .select('text, sender_user_id, created_at')
      .in('day_id', dayIds)
      .order('created_at', { ascending: true })

    if (!messages?.length) throw new Error('메시지가 없습니다')

    // Get member profiles
    const { data: members } = await supabase
      .from('couple_members')
      .select('user_id, profiles:user_id(nickname)')
      .eq('couple_id', membership.couple_id)

    const nickMap: Record<string, string> = {}
    members?.forEach(m => {
      nickMap[m.user_id] = (m as any).profiles?.nickname || 'User'
    })

    const conversation = messages.map(m =>
      `${nickMap[m.sender_user_id] || 'User'}: ${m.text}`
    ).join('\n')

    const result = await chatCompletionJSON<{
      title: string
      diary_text: string
      mood: Record<string, string>
      highlights: string[]
    }>([
      {
        role: 'system',
        content: `당신은 커플 대화를 분석하여 일기를 작성하는 도우미입니다.
대화 내용을 읽고 다음 JSON 형식으로 응답하세요:
{
  "title": "재치있는 일기 제목 (20자 이내)",
  "diary_text": "따뜻하고 공감적인 일기 본문 (300자 내외). 대화에서 느껴지는 감정과 주요 이벤트를 포함",
  "mood": { "전체 분위기": "happy/sad/excited/calm/tense 중 하나", "사랑 온도": "1~10 숫자 문자열" },
  "highlights": ["하이라이트 1", "하이라이트 2", "하이라이트 3"]
}`
      },
      { role: 'user', content: conversation }
    ], { temperature: 0.8 })

    // Upsert daily summary
    const { data: summary, error: upsertError } = await admin
      .from('daily_summaries')
      .upsert({
        couple_id: membership.couple_id,
        date,
        title: result.title,
        diary_text: result.diary_text,
        mood: result.mood,
        highlights: result.highlights,
      }, { onConflict: 'couple_id,date' })
      .select()
      .single()

    if (upsertError) throw upsertError

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
