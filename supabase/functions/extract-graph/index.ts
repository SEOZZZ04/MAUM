import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

interface GraphExtraction {
  nodes: Array<{ label: string; type: string }>
  edges: Array<{ source: string; source_type: string; target: string; target_type: string; relation: string }>
}

const HUB_NODE = { label: '커플 대화 허브', type: 'topic' } as const

const CANONICAL_RELATIONS = [
  'causes',
  'relates_to',
  'triggers',
  'resolves',
  'prefers',
  'avoids',
  'conflicts_with',
  'supports',
  'mentions',
  'feels',
  'planned_for',
  'visits',
  'participates_in',
  'part_of',
] as const

const RELATION_MAP: Record<string, typeof CANONICAL_RELATIONS[number]> = {
  '원인됨': 'causes',
  '관련됨': 'relates_to',
  '유발함': 'triggers',
  '해결함': 'resolves',
  '선호함': 'prefers',
  '회피함': 'avoids',
  '갈등됨': 'conflicts_with',
  '지지함': 'supports',
  '언급함': 'mentions',
  '느낌': 'feels',
  '계획함': 'planned_for',
  '방문함': 'visits',
  '참여함': 'participates_in',
  '부분임': 'part_of',

  causes: 'causes',
  cause: 'causes',
  relates_to: 'relates_to',
  related_to: 'relates_to',
  relates: 'relates_to',
  triggers: 'triggers',
  trigger: 'triggers',
  resolves: 'resolves',
  resolve: 'resolves',
  prefers: 'prefers',
  prefer: 'prefers',
  avoids: 'avoids',
  avoid: 'avoids',
  conflicts_with: 'conflicts_with',
  conflict_with: 'conflicts_with',
  supports: 'supports',
  support: 'supports',
  mentions: 'mentions',
  mention: 'mentions',
  feels: 'feels',
  feel: 'feels',
  planned_for: 'planned_for',
  plans_for: 'planned_for',
  plan_for: 'planned_for',
  planned: 'planned_for',
  visits: 'visits',
  visit: 'visits',
  participates_in: 'participates_in',
  participate_in: 'participates_in',
  participates: 'participates_in',
  part_of: 'part_of',
  partof: 'part_of',
}

function normalizeRelation(relation: string): typeof CANONICAL_RELATIONS[number] {
  const raw = (relation || '').trim()
  const normalizedKey = raw.toLowerCase().replace(/[\s-]+/g, '_')

  return RELATION_MAP[raw] || RELATION_MAP[normalizedKey] || 'relates_to'
}

const normalizeNodeLabel = (label: string) => label.trim().replace(/\s+/g, ' ')
const normalizeNodeType = (type: string) => type.trim().toLowerCase()
const nodeKey = (label: string, type: string) => `${normalizeNodeLabel(label)}:${normalizeNodeType(type)}`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const admin = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { text, source_info, context_summary } = await req.json()
    if (!text) throw new Error('text required')

    // Get couple
    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const coupleId = membership.couple_id

    // Fetch existing graph nodes to provide context for linking
    const { data: existingNodes } = await admin
      .from('graph_nodes')
      .select('label, type, weight')
      .eq('couple_id', coupleId)
      .order('weight', { ascending: false })
      .limit(50)

    const existingNodesList = (existingNodes || [])
      .map(n => `${n.label} (${n.type}, 가중치:${n.weight})`)
      .join(', ')

    // Build context block for conversation continuity
    let contextBlock = ''
    if (context_summary) {
      contextBlock = `\n\n## 이전 대화 맥락 요약\n${context_summary}\n위 맥락을 참고하여 새 대화에서 나온 요소들이 기존 맥락과 연결되도록 하세요.`
    }

    // Build existing nodes reference
    let existingNodesBlock = ''
    if (existingNodesList) {
      existingNodesBlock = `\n\n## 기존 그래프 노드 (이미 존재하는 노드)\n${existingNodesList}\n\n**중요**: 새로 추출하는 노드가 위 기존 노드와 의미적으로 관련이 있다면, 반드시 엣지(관계)로 연결하세요.\n예를 들어 "캠핑"이 기존 노드에 있고 대화에서 "캠핑용품"이나 "렌트카"가 언급되면, "캠핑용품"→"캠핑" (관련됨), "렌트카"→"캠핑" (관련됨) 관계를 만드세요.\n기존 노드와 동일한 개념이면 같은 label을 사용하세요 (새 노드를 만들지 마세요).`
    }

    const extraction = await chatCompletionJSON<GraphExtraction>([
      {
        role: 'system',
        content: `커플 대화에서 의미 있는 지식 그래프 노드와 관계를 추출합니다.
대화에는 화자(누가 말했는지)가 표시되어 있습니다. 화자 정보를 활용하여 누가 어떤 주제에 대해 말했는지, 누가 어떤 감정을 느꼈는지 등을 반영하세요.

## 노드 타입
person, topic, event, emotion, habit, value, place, plan

## 관계 타입 (한국어로 표시)
원인됨, 관련됨, 유발함, 해결함, 선호함, 회피함, 갈등됨, 지지함, 언급함, 느낌, 계획함, 방문함, 참여함

## 맥락 연결 규칙 (매우 중요!)
1. **상위-하위 개념 연결**: 구체적인 개념은 반드시 상위 개념과 연결하세요.
   - 예: "캠핑용품" → "캠핑" (관련됨), "렌트카" → "여행" (관련됨)
   - 예: "파스타" → "요리" (관련됨), "한강공원" → "산책" (관련됨)
2. **화자-주제 연결**: 누군가 특정 주제를 언급하면 화자와 주제를 연결하세요.
   - 예: "민수" → "캠핑" (언급함), "지은" → "스트레스" (느낌)
3. **시간적/인과적 연결**: 한 사건이 다른 사건으로 이어지면 연결하세요.
   - 예: "야근" → "피로" (유발함), "여행계획" → "설렘" (유발함)
4. **동일 대화 맥락 내 연결**: 같은 대화 흐름에서 언급된 관련 요소들은 서로 연결하세요.
${existingNodesBlock}${contextBlock}

## 추출 기준
다음과 같은 **의미 있는 내용만** 추출하세요:
- 새로운 사건이나 경험 (예: 여행 계획, 직장 문제, 가족 모임)
- 감정 변화나 중요한 감정 표현 (예: 스트레스, 행복, 불안, 사랑)
- 관계에 관한 정보 (가족, 친구, 직장 동료 등 인물)
- 새로운 장소나 계획
- 가치관이나 습관에 대한 언급
- 갈등이나 갈등 해소
- 화자(사람 노드)와 그들이 말한 주제/감정의 관계

다음은 **무시**하세요:
- 단순 인사 (안녕, 잘 잤어?, 뭐해? 등)
- 일상적인 짧은 응답 (ㅋㅋ, ㅇㅇ, 그래, 응 등)
- 의미 없는 반복적인 대화
- 음식 주문이나 단순 일상 보고 (밥 먹었어 등) - 단, 특별한 맥락이 있으면 추출

대화에 의미 있는 내용이 없으면 빈 배열을 반환하세요.

## 응답 형식 (반드시 JSON)
{
  "nodes": [{"label": "노드명", "type": "person|topic|event|emotion|habit|value|place|plan"}],
  "edges": [{"source": "노드명", "source_type": "타입", "target": "노드명", "target_type": "타입", "relation": "관계타입(한국어)"}]
}

노드는 최대 10개, 엣지는 최대 20개. 의미 있는 연결을 충분히 만드세요. 특히 기존 노드와의 연결을 놓치지 마세요.`
      },
      { role: 'user', content: text }
    ], { temperature: 0.3 })

    // Upsert nodes
    const nodeIds: Record<string, string> = {}
    const newlyCreatedNodeIds = new Set<string>()
    const newlyCreatedNonSeedNodeIds = new Set<string>()

    const ensureNode = async (
      rawLabel: string,
      rawType: string,
      options: { nonSeed: boolean },
    ): Promise<string | null> => {
      const label = normalizeNodeLabel(rawLabel)
      const type = normalizeNodeType(rawType)
      const key = nodeKey(label, type)
      if (nodeIds[key]) return nodeIds[key]

      // First check if node exists (exact match)
      const { data: existing } = await admin
        .from('graph_nodes')
        .select('id, weight')
        .eq('couple_id', coupleId)
        .eq('label', label)
        .eq('type', type)
        .maybeSingle()

      if (existing) {
        await admin
          .from('graph_nodes')
          .update({
            weight: existing.weight + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        nodeIds[key] = existing.id
        return existing.id
      } else {
        const { data, error } = await admin
          .from('graph_nodes')
          .insert({
            couple_id: coupleId,
            label,
            type,
            weight: 1,
            last_seen_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (!error && data) {
          nodeIds[key] = data.id
          newlyCreatedNodeIds.add(data.id)
          if (options.nonSeed) newlyCreatedNonSeedNodeIds.add(data.id)
          return data.id
        }
      }

      return null
    }

    const normalizedNodes = (extraction.nodes || []).map((node) => ({
      label: normalizeNodeLabel(node.label),
      type: normalizeNodeType(node.type),
    }))

    for (const node of normalizedNodes) {
      await ensureNode(node.label, node.type, { nonSeed: true })
    }

    const normalizedEdges = (extraction.edges || []).map((edge) => ({
      source: normalizeNodeLabel(edge.source),
      source_type: normalizeNodeType(edge.source_type),
      target: normalizeNodeLabel(edge.target),
      target_type: normalizeNodeType(edge.target_type),
      relation: normalizeRelation(edge.relation),
    }))

    let edgeInsertFailedCount = 0

    // If edge endpoints are not in DB, create them immediately and retry linking.
    for (const edge of normalizedEdges) {
      const sourceId = await ensureNode(edge.source, edge.source_type, { nonSeed: false })
      if (!sourceId) edgeInsertFailedCount++

      const targetId = await ensureNode(edge.target, edge.target_type, { nonSeed: false })
      if (!targetId) edgeInsertFailedCount++
    }

    const upsertEdge = async (
      sourceId: string,
      targetId: string,
      relation: string,
      evidence: string[] = [],
    ): Promise<boolean> => {
      const { data: existingEdge, error: existingEdgeError } = await admin
        .from('graph_edges')
        .select('id, weight')
        .eq('couple_id', coupleId)
        .eq('source_node_id', sourceId)
        .eq('target_node_id', targetId)
        .eq('relation', relation)
        .maybeSingle()

      if (existingEdgeError) return false

      if (existingEdge) {
        const { error: updateError } = await admin
          .from('graph_edges')
          .update({
            weight: existingEdge.weight + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existingEdge.id)
        return !updateError
      }

      const { error: insertError } = await admin
        .from('graph_edges')
        .insert({
          couple_id: coupleId,
          source_node_id: sourceId,
          target_node_id: targetId,
          relation,
          weight: 1,
          last_seen_at: new Date().toISOString(),
          evidence,
        })

      return !insertError
    }

    // Upsert edges
    let edgesCreated = 0
    for (const edge of normalizedEdges) {
      const sourceId = nodeIds[nodeKey(edge.source, edge.source_type)]
      const targetId = nodeIds[nodeKey(edge.target, edge.target_type)]
      if (!sourceId || !targetId) {
        edgeInsertFailedCount++
        continue
      }

      const success = await upsertEdge(
        sourceId,
        targetId,
        edge.relation,
        source_info ? [source_info] : [],
      )
      if (success) {
        edgesCreated++
      } else {
        edgeInsertFailedCount++
      }
    }

    // Batch validation: every newly-created non-seed node must have at least one in/out edge.
    let orphanPreventedCount = 0
    if (newlyCreatedNonSeedNodeIds.size > 0) {
      const hubId = await ensureNode(HUB_NODE.label, HUB_NODE.type, { nonSeed: false })

      for (const nodeId of newlyCreatedNonSeedNodeIds) {
        const { data: connectedEdge, error: connectedEdgeError } = await admin
          .from('graph_edges')
          .select('id')
          .eq('couple_id', coupleId)
          .or(`source_node_id.eq.${nodeId},target_node_id.eq.${nodeId}`)
          .limit(1)
          .maybeSingle()

        if (connectedEdgeError || connectedEdge) continue

        let isConnected = false
        if (hubId && hubId !== nodeId) {
          isConnected = await upsertEdge(nodeId, hubId, normalizeRelation('관련됨'))
          if (isConnected) {
            orphanPreventedCount++
            edgesCreated++
          } else {
            edgeInsertFailedCount++
          }
        }

        if (!isConnected) {
          const { error: deleteError } = await admin
            .from('graph_nodes')
            .delete()
            .eq('id', nodeId)
            .eq('couple_id', coupleId)

          if (!deleteError) {
            orphanPreventedCount++
            newlyCreatedNodeIds.delete(nodeId)
          }
        }
      }
    }

    return new Response(JSON.stringify({
      nodes_count: newlyCreatedNodeIds.size,
      edges_count: edgesCreated,
      orphan_prevented_count: orphanPreventedCount,
      edge_insert_failed_count: edgeInsertFailedCount,
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
