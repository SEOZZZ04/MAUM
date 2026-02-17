import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Step 1 output – high-level topic anchors */
interface TopicAnchors {
  main_topics: Array<{ label: string; type: string }>
}

/** Step 3 output – full graph extraction */
interface GraphExtraction {
  nodes: Array<{ label: string; type: string }>
  edges: Array<{
    source: string
    source_type: string
    target: string
    target_type: string
    relation: string
    reason?: string
  }>
}

// ---------------------------------------------------------------------------
// Canonical relation handling
// ---------------------------------------------------------------------------

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
  // Korean relations used by prompt
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

  // Canonical + common aliases
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

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

    // ---------------------------------------------------------------
    // [STEP 1] 주제 앵커링 (Topic Anchoring)
    // VIS의 "Collection / MOC" 개념: 대화의 그릇이 되는 주제를 먼저 정의
    // 세부 사항(와인, 렌트카)이 아니라 포괄하는 상위 주제(캠핑, 여행)를 식별
    // ---------------------------------------------------------------
    const topicExtraction = await chatCompletionJSON<TopicAnchors>([
      {
        role: 'system',
        content: `당신은 커플 대화 분석 전문가입니다. 대화 내용을 분석하여 **핵심 주제(Topic Anchor)**를 추출합니다.

## 규칙
1. 대화의 핵심 주제 1~3개만 추출하세요.
2. 세부적인 사물(와인, 렌트카, 텐트 등)이 아니라 이를 **포괄하는 상위 개념**(캠핑, 여행, 집들이, 결혼 준비 등)이어야 합니다.
3. 각 주제에 적절한 타입을 부여하세요: event, topic, plan, place, value 중 하나.
4. 대화에 의미 있는 주제가 없으면 빈 배열을 반환하세요.

## 예시
- 캠핑 준비 대화 → [{"label": "캠핑", "type": "event"}]
- 이직 고민 + 스트레스 대화 → [{"label": "이직", "type": "plan"}, {"label": "직장 스트레스", "type": "topic"}]
- 주말 데이트 장소 대화 → [{"label": "데이트", "type": "event"}]

## 응답 형식 (반드시 JSON)
{"main_topics": [{"label": "주제명", "type": "타입"}]}`
      },
      { role: 'user', content: text }
    ], { temperature: 0.1 })

    const mainTopics = topicExtraction.main_topics || []

    // ---------------------------------------------------------------
    // [STEP 2] 주제 관련 기존 노드 검색 (Context Retrieval)
    // VIS의 "검색 에이전트" 개념: 상위 50개(Weight순)가 아니라 '관련성'으로 검색
    // 주제 앵커와 관련된 기존 노드를 찾아 LLM에게 컨텍스트로 주입
    // ---------------------------------------------------------------

    // 2a. 주제 키워드로 관련 기존 노드 검색 (ILIKE 기반)
    let topicRelatedNodes: Array<{ label: string; type: string; weight: number }> = []
    if (mainTopics.length > 0) {
      const topicLabels = mainTopics.map(t => t.label)
      // 각 주제에 대해 ILIKE 검색으로 관련 노드 찾기
      const orFilter = topicLabels
        .map(label => `label.ilike.%${label}%`)
        .join(',')

      const { data: relatedNodes } = await admin
        .from('graph_nodes')
        .select('label, type, weight')
        .eq('couple_id', coupleId)
        .or(orFilter)
        .order('weight', { ascending: false })
        .limit(20)

      topicRelatedNodes = relatedNodes || []
    }

    // 2b. 기존 상위 가중치 노드도 함께 가져오기 (기존 로직 보존)
    const { data: existingNodes } = await admin
      .from('graph_nodes')
      .select('label, type, weight')
      .eq('couple_id', coupleId)
      .order('weight', { ascending: false })
      .limit(50)

    // 2c. 주제 관련 노드 + 상위 노드를 합쳐서 중복 제거
    const allContextNodes = new Map<string, { label: string; type: string; weight: number }>()

    // 주제 관련 노드 먼저 (우선순위 높음)
    for (const n of topicRelatedNodes) {
      allContextNodes.set(`${n.label}:${n.type}`, n)
    }
    // 상위 가중치 노드 추가
    for (const n of (existingNodes || [])) {
      const key = `${n.label}:${n.type}`
      if (!allContextNodes.has(key)) {
        allContextNodes.set(key, n)
      }
    }

    const existingNodesList = Array.from(allContextNodes.values())
      .map(n => `${n.label} (${n.type}, 가중치:${n.weight})`)
      .join(', ')

    // ---------------------------------------------------------------
    // Build context blocks for prompts
    // ---------------------------------------------------------------

    // 이전 대화 맥락 블록
    let contextBlock = ''
    if (context_summary) {
      contextBlock = `\n\n## 이전 대화 맥락 요약\n${context_summary}\n위 맥락을 참고하여 새 대화에서 나온 요소들이 기존 맥락과 연결되도록 하세요.`
    }

    // 기존 노드 참조 블록
    let existingNodesBlock = ''
    if (existingNodesList) {
      existingNodesBlock = `\n\n## 기존 그래프 노드 (이미 존재하는 노드)\n${existingNodesList}\n\n**중요**: 새로 추출하는 노드가 위 기존 노드와 의미적으로 관련이 있다면, 반드시 엣지(관계)로 연결하세요.\n기존 노드와 동일한 개념이면 같은 label을 사용하세요 (새 노드를 만들지 마세요).`
    }

    // 주제 앵커 블록 (VIS의 핵심: 앵커를 명시적으로 주입)
    let topicAnchorBlock = ''
    if (mainTopics.length > 0) {
      const topicList = mainTopics
        .map(t => `**${t.label}** (${t.type})`)
        .join(', ')
      topicAnchorBlock = `\n\n## 🎯 핵심 주제 앵커 (Topic Anchors) — 가장 중요!
이 대화의 핵심 주제: ${topicList}

**필수 규칙 (Topic Anchoring Strategy)**:
1. 위 핵심 주제 노드를 반드시 nodes 배열에 포함하세요.
2. 대화에서 등장하는 **모든 세부 사물, 장소, 계획, 감정**은 반드시 위 핵심 주제 중 하나와 엣지로 연결되어야 합니다.
   - 예: 핵심 주제가 "캠핑"이고 "와인"이 언급되면 → "와인" → "캠핑" (관련됨) 엣지 필수
   - 예: 핵심 주제가 "캠핑"이고 "렌트카"가 언급되면 → "렌트카" → "캠핑" (관련됨) 엣지 필수
3. 어떤 세부 노드든 핵심 주제와의 연결 없이 단독으로 존재해서는 안 됩니다.
4. reason 필드에 왜 이 연결이 존재하는지 간단히 설명하세요 (예: "캠핑 갈 때 마실 와인을 사기로 함").`
    }

    // ---------------------------------------------------------------
    // [STEP 3] 앵커 기반 그래프 추출 (Anchor-based Graph Extraction)
    // VIS의 "재귀적 연결" 개념: 세부 사항을 앵커에 강제로 연결
    // ---------------------------------------------------------------
    const extraction = await chatCompletionJSON<GraphExtraction>([
      {
        role: 'system',
        content: `커플 대화에서 의미 있는 지식 그래프 노드와 관계를 추출합니다.
대화에는 화자(누가 말했는지)가 표시되어 있습니다. 화자 정보를 활용하여 누가 어떤 주제에 대해 말했는지, 누가 어떤 감정을 느꼈는지 등을 반영하세요.

## 노드 타입
person, topic, event, emotion, habit, value, place, plan

## 관계 타입 (한국어로 표시)
원인됨, 관련됨, 유발함, 해결함, 선호함, 회피함, 갈등됨, 지지함, 언급함, 느낌, 계획함, 방문함, 참여함, 부분임
${topicAnchorBlock}

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
  "edges": [{"source": "노드명", "source_type": "타입", "target": "노드명", "target_type": "타입", "relation": "관계타입(한국어)", "reason": "이 연결이 존재하는 이유 (짧은 한국어 설명)"}]
}

노드는 최대 10개, 엣지는 최대 20개. 의미 있는 연결을 충분히 만드세요. 특히 핵심 주제와의 연결, 기존 노드와의 연결을 놓치지 마세요.`
      },
      { role: 'user', content: text }
    ], { temperature: 0.3 })

    // ---------------------------------------------------------------
    // [POST-PROCESSING] 앵커 노드 보장 및 고아 노드 연결
    // 주제 앵커가 추출 결과에 누락된 경우 강제 삽입
    // ---------------------------------------------------------------
    const extractedNodes = extraction.nodes || []
    const extractedEdges = extraction.edges || []

    // 앵커 노드가 추출 결과에 없으면 추가
    for (const topic of mainTopics) {
      const exists = extractedNodes.some(
        n => n.label === topic.label && n.type === topic.type
      )
      if (!exists) {
        extractedNodes.push({ label: topic.label, type: topic.type })
      }
    }

    // 고아 노드 검사: 어떤 엣지에도 포함되지 않은 노드를 주제 앵커에 연결
    if (mainTopics.length > 0) {
      const connectedLabels = new Set<string>()
      for (const edge of extractedEdges) {
        connectedLabels.add(edge.source)
        connectedLabels.add(edge.target)
      }

      const primaryAnchor = mainTopics[0]
      for (const node of extractedNodes) {
        // 앵커 자신은 건너뜀
        const isAnchor = mainTopics.some(
          t => t.label === node.label && t.type === node.type
        )
        if (isAnchor) continue

        // person 노드도 건너뜀 (화자 연결은 별도 처리됨)
        if (node.type === 'person') continue

        if (!connectedLabels.has(node.label)) {
          extractedEdges.push({
            source: node.label,
            source_type: node.type,
            target: primaryAnchor.label,
            target_type: primaryAnchor.type,
            relation: '관련됨',
            reason: `${node.label}이(가) ${primaryAnchor.label} 맥락에서 언급됨`,
          })
        }
      }
    }

    // ---------------------------------------------------------------
    // Upsert nodes
    // ---------------------------------------------------------------
    const nodeIds: Record<string, string> = {}
    for (const node of extractedNodes) {
      // First check if node exists (exact match)
      const { data: existing } = await admin
        .from('graph_nodes')
        .select('id, weight')
        .eq('couple_id', coupleId)
        .eq('label', node.label)
        .eq('type', node.type)
        .maybeSingle()

      if (existing) {
        await admin
          .from('graph_nodes')
          .update({
            weight: existing.weight + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        nodeIds[`${node.label}:${node.type}`] = existing.id
      } else {
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

    // Also resolve existing nodes referenced in edges but not in current extraction
    // This allows linking new nodes to existing ones
    for (const edge of extractedEdges) {
      for (const side of ['source', 'target'] as const) {
        const label = edge[side]
        const type = side === 'source' ? edge.source_type : edge.target_type
        const key = `${label}:${type}`
        if (!nodeIds[key]) {
          // Check if this node already exists in the DB
          const { data: existingNode } = await admin
            .from('graph_nodes')
            .select('id')
            .eq('couple_id', coupleId)
            .eq('label', label)
            .eq('type', type)
            .maybeSingle()
          if (existingNode) {
            nodeIds[key] = existingNode.id
          }
        }
      }
    }

    // ---------------------------------------------------------------
    // Upsert edges (with enhanced evidence from reason field)
    // ---------------------------------------------------------------
    let edgesCreated = 0
    const edgeFailures: Array<{ edge: GraphExtraction['edges'][number]; reason: string }> = []
    for (const edge of extractedEdges) {
      const sourceId = nodeIds[`${edge.source}:${edge.source_type}`]
      const targetId = nodeIds[`${edge.target}:${edge.target_type}`]
      if (!sourceId || !targetId) {
        const reason = !sourceId && !targetId
          ? 'source and target node not found'
          : !sourceId
            ? 'source node not found'
            : 'target node not found'
        edgeFailures.push({ edge, reason })
        console.error('[extract-graph] edge skipped (node resolution failed)', { edge, reason })
        continue
      }

      const relation = normalizeRelation(edge.relation)

      // Build evidence entry with source info and LLM-provided reason
      const evidenceEntry: Record<string, string> = {}
      if (source_info) evidenceEntry.source = source_info
      if (edge.reason) evidenceEntry.reason = edge.reason

      const { data: existingEdge } = await admin
        .from('graph_edges')
        .select('id, weight, evidence')
        .eq('couple_id', coupleId)
        .eq('source_node_id', sourceId)
        .eq('target_node_id', targetId)
        .eq('relation', relation)
        .maybeSingle()

      if (existingEdge) {
        // Append new evidence to existing array
        const updatedEvidence = Array.isArray(existingEdge.evidence)
          ? [...existingEdge.evidence]
          : []
        if (Object.keys(evidenceEntry).length > 0) {
          updatedEvidence.push(evidenceEntry)
        }

        const { error: updateError } = await admin
          .from('graph_edges')
          .update({
            weight: existingEdge.weight + 1,
            last_seen_at: new Date().toISOString(),
            evidence: updatedEvidence,
          })
          .eq('id', existingEdge.id)
        if (updateError) {
          edgeFailures.push({ edge, reason: updateError.message })
          console.error('[extract-graph] edge update failed', { edge, relation, error: updateError.message })
          continue
        }
      } else {
        const initialEvidence = Object.keys(evidenceEntry).length > 0
          ? [evidenceEntry]
          : source_info ? [source_info] : []

        const { error: insertError } = await admin
          .from('graph_edges')
          .insert({
            couple_id: coupleId,
            source_node_id: sourceId,
            target_node_id: targetId,
            relation,
            weight: 1,
            last_seen_at: new Date().toISOString(),
            evidence: initialEvidence,
          })
        if (insertError) {
          edgeFailures.push({ edge, reason: insertError.message })
          console.error('[extract-graph] edge insert failed', { edge, relation, error: insertError.message })
          continue
        }
      }

      edgesCreated++
    }

    return new Response(JSON.stringify({
      topic_anchors: mainTopics.map(t => t.label),
      nodes_count: extractedNodes.length,
      edges_count: edgesCreated,
      edge_failures_count: edgeFailures.length,
      edge_failures: edgeFailures,
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
