import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'

interface ParsedMessage {
  date: string
  time: string
  sender: string
  text: string
}

function parseKakaoTxt(content: string): ParsedMessage[] {
  const lines = content.split('\n')
  const messages: ParsedMessage[] = []
  // Pattern: YYYY. M. D. HH:MM, sender : text
  // or: YYYY-MM-DD HH:MM:SS, sender : text
  const pattern1 = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{1,2}:\d{2}),\s*(.+?)\s*:\s*(.+)$/
  const pattern2 = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2}),\s*(.+?)\s*:\s*(.+)$/
  // Pattern for "yyyy년 mm월 dd일 오전/오후 h:mm, sender : text"
  const pattern3 = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s*(.+)$/

  let currentMsg: ParsedMessage | null = null

  for (const line of lines) {
    let match = line.match(pattern1)
    if (match) {
      if (currentMsg) messages.push(currentMsg)
      const date = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`
      currentMsg = { date, time: match[4], sender: match[5].trim(), text: match[6] }
      continue
    }

    match = line.match(pattern2)
    if (match) {
      if (currentMsg) messages.push(currentMsg)
      currentMsg = { date: match[1], time: match[2], sender: match[3].trim(), text: match[4] }
      continue
    }

    match = line.match(pattern3)
    if (match) {
      if (currentMsg) messages.push(currentMsg)
      const date = `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`
      let hour = parseInt(match[5])
      if (match[4] === '오후' && hour < 12) hour += 12
      if (match[4] === '오전' && hour === 12) hour = 0
      const time = `${String(hour).padStart(2,'0')}:${match[6]}`
      currentMsg = { date, time, sender: match[7].trim(), text: match[8] }
      continue
    }

    // Continuation line
    if (currentMsg && line.trim()) {
      currentMsg.text += '\n' + line
    }
  }
  if (currentMsg) messages.push(currentMsg)
  return messages
}

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

    // Get couple
    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .single()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const coupleId = membership.couple_id

    // Download file from storage
    const { data: fileData, error: dlError } = await admin.storage
      .from('uploads')
      .download(upload.storage_path)
    if (dlError) throw dlError

    const content = await fileData.text()
    const parsed = parseKakaoTxt(content)

    if (!parsed.length) {
      return new Response(JSON.stringify({ message_count: 0, dates: [], error: '파싱된 메시지가 없습니다' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Group by date
    const byDate = new Map<string, ParsedMessage[]>()
    for (const msg of parsed) {
      if (!byDate.has(msg.date)) byDate.set(msg.date, [])
      byDate.get(msg.date)!.push(msg)
    }

    const dates: string[] = []

    for (const [date, msgs] of byDate) {
      dates.push(date)

      // Ensure conversation_day exists
      const { data: existingDay } = await admin
        .from('conversation_days')
        .select('id')
        .eq('couple_id', coupleId)
        .eq('date', date)
        .eq('archived', false)
        .single()

      let dayId: string
      if (existingDay) {
        dayId = existingDay.id
      } else {
        const { data: newDay } = await admin
          .from('conversation_days')
          .insert({ couple_id: coupleId, date, title: date })
          .select('id')
          .single()
        dayId = newDay!.id
      }

      // Insert messages
      const rows = msgs.map(m => ({
        couple_id: coupleId,
        day_id: dayId,
        sender_user_id: user.id,
        text: `[${m.sender}] ${m.text}`,
        source: 'kakao_import',
        created_at: `${m.date}T${m.time}:00+09:00`,
        metadata: { original_sender: m.sender, import_upload_id: upload_id },
      }))

      await admin.from('messages').insert(rows)
    }

    return new Response(JSON.stringify({
      message_count: parsed.length,
      dates: dates.sort(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
