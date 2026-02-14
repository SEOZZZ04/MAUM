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

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (profile?.role !== 'admin') throw new Error('Forbidden: admin only')

    // Total users
    const { count: totalUsers } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    // Total couples
    const { count: totalCouples } = await admin
      .from('couples')
      .select('*', { count: 'exact', head: true })

    // DAU: users who sent messages today
    const today = new Date().toISOString().split('T')[0]
    const { data: dauData } = await admin
      .from('messages')
      .select('sender_user_id')
      .gte('created_at', today + 'T00:00:00Z')

    const dauSet = new Set(dauData?.map(m => m.sender_user_id) || [])

    // WAU: users who sent messages in last 7 days
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: wauData } = await admin
      .from('messages')
      .select('sender_user_id')
      .gte('created_at', weekAgo)

    const wauSet = new Set(wauData?.map(m => m.sender_user_id) || [])

    // Per couple details
    const { data: allCouples } = await admin
      .from('couples')
      .select('id')

    const couples = []
    for (const c of (allCouples || [])) {
      const { data: members } = await admin
        .from('couple_members')
        .select('user_id, profiles:user_id(nickname)')
        .eq('couple_id', c.id)

      const { count: messageCount } = await admin
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('couple_id', c.id)

      const { count: diaryCount } = await admin
        .from('daily_summaries')
        .select('*', { count: 'exact', head: true })
        .eq('couple_id', c.id)

      const { count: nodeCount } = await admin
        .from('graph_nodes')
        .select('*', { count: 'exact', head: true })
        .eq('couple_id', c.id)

      couples.push({
        couple_id: c.id,
        members: members?.map(m => (m as any).profiles?.nickname || 'User') || [],
        message_count: messageCount || 0,
        diary_count: diaryCount || 0,
        node_count: nodeCount || 0,
      })
    }

    return new Response(JSON.stringify({
      total_users: totalUsers || 0,
      total_couples: totalCouples || 0,
      dau: dauSet.size,
      wau: wauSet.size,
      couples,
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
