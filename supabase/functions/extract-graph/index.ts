import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

interface GraphExtraction {
  nodes: Array<{ label: string; type: string }>
  edges: Array<{ source: string; source_type: string; target: string; target_type: string; relation: string }>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const admin = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { text, source_info } = await req.json()
    if (!text) throw new Error('text required')

    // Get couple
    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const coupleId = membership.couple_id

    const extraction = await chatCompletionJSON<GraphExtraction>([
      {
        role: 'system',
        content: `커플 대화에서 지식 그래프를 추출합니다.
노드 타입: person, topic, event, emotion, habit, value, place, plan
관계 타입: causes, relates_to, triggers, resolves, prefers, avoids, conflicts_with, supports

반드시 JSON으로 응답:
{
  "nodes": [{"label": "노드명", "type": "person|topic|event|emotion|habit|value|place|plan"}],
  "edges": [{"source": "노드명", "source_type": "타입", "target": "노드명", "target_type": "타입", "relation": "관계타입"}]
}

핵심 개념만 추출하세요. 노드는 최대 15개, 엣지는 최대 20개.`
      },
      { role: 'user', content: text }
    ], { temperature: 0.5 })

    // Upsert nodes
    const nodeIds: Record<string, string> = {}
    for (const node of (extraction.nodes || [])) {
      // First check if node exists
      const { data: existing } = await admin
        .from('graph_nodes')
        .select('id, weight')
        .eq('couple_id', coupleId)
        .eq('label', node.label)
        .eq('type', node.type)
        .maybeSingle()

      if (existing) {
        // Update weight and last_seen_at
        await admin
          .from('graph_nodes')
          .update({
            weight: existing.weight + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        nodeIds[`${node.label}:${node.type}`] = existing.id
      } else {
        // Insert new node
        const { data, error } = await admin
          .from('graph_nodes')
          .insert({
            couple_id: coupleId,
            label: node.label,
            type: node.type,
            weight: 1,
            last_seen_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (!error && data) {
          nodeIds[`${node.label}:${node.type}`] = data.id
        }
      }
    }

    // Upsert edges
    let edgesCreated = 0
    for (const edge of (extraction.edges || [])) {
      const sourceId = nodeIds[`${edge.source}:${edge.source_type}`]
      const targetId = nodeIds[`${edge.target}:${edge.target_type}`]
      if (!sourceId || !targetId) continue

      // Check if edge exists
      const { data: existingEdge } = await admin
        .from('graph_edges')
        .select('id, weight')
        .eq('couple_id', coupleId)
        .eq('source_node_id', sourceId)
        .eq('target_node_id', targetId)
        .eq('relation', edge.relation)
        .maybeSingle()

      if (existingEdge) {
        await admin
          .from('graph_edges')
          .update({
            weight: existingEdge.weight + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existingEdge.id)
      } else {
        await admin
          .from('graph_edges')
          .insert({
            couple_id: coupleId,
            source_node_id: sourceId,
            target_node_id: targetId,
            relation: edge.relation,
            weight: 1,
            last_seen_at: new Date().toISOString(),
            evidence: source_info ? [source_info] : [],
          })
      }
      edgesCreated++
    }

    return new Response(JSON.stringify({
      nodes_count: extraction.nodes?.length || 0,
      edges_count: edgesCreated,
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
