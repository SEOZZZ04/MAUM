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

    const { code } = await req.json()
    if (!code) throw new Error('코드를 입력해주세요')

    // Check if redeemer already has a couple
    const { data: existingCouple } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .single()
    if (existingCouple) throw new Error('이미 커플이 연동되어 있습니다')

    // Find invite
    const { data: invite, error: findError } = await admin
      .from('couple_invites')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (findError || !invite) throw new Error('유효하지 않거나 만료된 코드입니다')
    if (invite.inviter_user_id === user.id) throw new Error('자신의 코드는 사용할 수 없습니다')

    // Create couple
    const { data: couple, error: coupleError } = await admin
      .from('couples')
      .insert({})
      .select()
      .single()
    if (coupleError) throw coupleError

    // Add both members
    const { error: memberError } = await admin
      .from('couple_members')
      .insert([
        { couple_id: couple.id, user_id: invite.inviter_user_id },
        { couple_id: couple.id, user_id: user.id },
      ])
    if (memberError) throw memberError

    // Mark invite as used
    await admin
      .from('couple_invites')
      .update({ used_at: new Date().toISOString(), used_by_user_id: user.id, couple_id: couple.id })
      .eq('id', invite.id)

    return new Response(JSON.stringify({ couple_id: couple.id, message: '커플 연동 완료!' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
