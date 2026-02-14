import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const admin = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { request_id } = await req.json()
    if (!request_id) throw new Error('request_id가 필요합니다')

    // Get the connection request
    const { data: request, error: reqError } = await admin
      .from('guest_connection_requests')
      .select('*')
      .eq('id', request_id)
      .single()

    if (reqError || !request) throw new Error('요청을 찾을 수 없습니다')
    if (request.to_user_id !== user.id) throw new Error('이 요청을 수락할 권한이 없습니다')
    if (request.status !== 'pending') throw new Error('이미 처리된 요청입니다')

    // Check neither user already has a couple
    const { data: existingFrom } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', request.from_user_id)
      .maybeSingle()
    if (existingFrom) throw new Error('상대방이 이미 커플 연동되어 있습니다')

    const { data: existingTo } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (existingTo) throw new Error('이미 커플이 연동되어 있습니다')

    // Create couple
    const { data: couple, error: coupleError } = await admin
      .from('couples')
      .insert({})
      .select()
      .single()
    if (coupleError) throw coupleError

    // Add both members (admin client bypasses RLS)
    const { error: memberError } = await admin
      .from('couple_members')
      .insert([
        { couple_id: couple.id, user_id: request.from_user_id },
        { couple_id: couple.id, user_id: user.id },
      ])
    if (memberError) throw memberError

    // Update request status
    await admin
      .from('guest_connection_requests')
      .update({ status: 'accepted' })
      .eq('id', request_id)

    return new Response(JSON.stringify({ couple_id: couple.id, message: '연결 완료!' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
