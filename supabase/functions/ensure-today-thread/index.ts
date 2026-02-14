import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    // Get couple
    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const today = new Date().toISOString().split('T')[0]

    // Try to find existing non-archived day
    const { data: existing } = await supabase
      .from('conversation_days')
      .select('*')
      .eq('couple_id', membership.couple_id)
      .eq('date', today)
      .eq('archived', false)
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ day: existing }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create new day
    const { data: newDay, error } = await supabase
      .from('conversation_days')
      .insert({
        couple_id: membership.couple_id,
        date: today,
        title: today,
      })
      .select()
      .single()
    if (error) throw error

    return new Response(JSON.stringify({ day: newDay }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
