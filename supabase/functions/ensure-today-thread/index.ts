import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'

function getKSTDate(): string {
  const now = new Date()
  // KST is UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().split('T')[0]
}

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

    const today = getKSTDate()

    // Archive any non-archived days from previous dates
    await supabase
      .from('conversation_days')
      .update({ archived: true })
      .eq('couple_id', membership.couple_id)
      .eq('archived', false)
      .lt('date', today)

    // Try to find existing non-archived day for today
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
