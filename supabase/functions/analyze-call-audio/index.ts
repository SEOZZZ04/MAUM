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

    const { upload_id } = await req.json()
    if (!upload_id) throw new Error('upload_id required')

    // Get upload
    const { data: upload } = await supabase
      .from('uploads')
      .select('*')
      .eq('id', upload_id)
      .single()
    if (!upload) throw new Error('Upload not found')

    const coupleId = upload.couple_id

    // Download audio from storage
    const { data: fileData, error: dlError } = await admin.storage
      .from('uploads')
      .download(upload.storage_path)
    if (dlError) throw dlError

    // Transcribe using OpenAI Whisper API
    const formData = new FormData()
    formData.append('file', fileData, 'audio.webm')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ko')

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      },
      body: formData,
    })

    if (!whisperRes.ok) {
      const errText = await whisperRes.text()
      throw new Error(`Whisper error: ${whisperRes.status} ${errText}`)
    }

    const whisperData = await whisperRes.json()
    const transcript = whisperData.text

    // Analyze with GPT
    const analysis = await chatCompletionJSON<{
      summary: string
      timeline: Array<{ text: string }>
      emotions: Record<string, string>
      keywords: string[]
      conflict_points: string[]
    }>([
      {
        role: 'system',
        content: `커플의 통화 내용을 분석합니다. 전사된 텍스트를 읽고 다음 JSON으로 응답하세요:
{
  "summary": "통화 요약 (200자 내외)",
  "timeline": [{"text": "대화 흐름 포인트 1"}, {"text": "대화 흐름 포인트 2"}, ...],
  "emotions": {"전체 분위기": "값", "주요 감정": "값"},
  "keywords": ["키워드1", "키워드2", ...],
  "conflict_points": ["갈등/화해 포인트 (있는 경우)"]
}`
      },
      { role: 'user', content: transcript }
    ], { temperature: 0.7 })

    // Save call log
    const { data: callLog, error: insertError } = await admin
      .from('call_logs')
      .insert({
        couple_id: coupleId,
        upload_id: upload_id,
        occurred_at: upload.occurred_at || new Date().toISOString(),
        transcript,
        summary: analysis.summary,
        timeline: analysis.timeline,
        emotions: analysis.emotions,
        keywords: analysis.keywords,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return new Response(JSON.stringify(callLog), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
