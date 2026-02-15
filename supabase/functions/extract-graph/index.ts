import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient, getSupabaseAdmin } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

type NodeType = 'person' | 'topic' | 'event' | 'emotion' | 'habit' | 'value' | 'place' | 'plan'

type GraphNode = { label: string; type: NodeType }
type GraphEdge = { source: string; source_type: NodeType; target: string; target_type: NodeType; relation: string }
type GraphExtraction = { nodes: GraphNode[]; edges: GraphEdge[] }
type HubNode = { label: string; type: Extract<NodeType, 'event' | 'plan' | 'topic'> }
type SeedExtraction = { hubs: HubNode[] }
type ExpansionNode = GraphNode & { connected_to_seed?: string; hub_label?: string }
type ExpansionExtraction = { nodes: ExpansionNode[]; edges: GraphEdge[] }

const ALLOWED_NODE_TYPES: NodeType[] = ['person', 'topic', 'event', 'emotion', 'habit', 'value', 'place', 'plan']
const ALLOWED_HUB_TYPES: HubNode['type'][] = ['event', 'plan', 'topic']

function normalizeLabel(value: string): string {
  return String(value || '').trim()
}

function normalizeType(value: string): NodeType | null {
  if (ALLOWED_NODE_TYPES.includes(value as NodeType)) return value as NodeType
  return null
}

function getNodeKey(label: string, type: string): string {
  return `${normalizeLabel(label)}:${type}`
}

function buildSimilarityScore(label: string, hubs: HubNode[]): number {
  const target = normalizeLabel(label).toLowerCase()
  if (!target) return 0
  let score = 0
  for (const hub of hubs) {
    const hubLabel = hub.label.toLowerCase()
    if (target === hubLabel) score += 100
    if (target.includes(hubLabel) || hubLabel.includes(target)) score += 20
    const hubTokens = hubLabel.split(/\s+/).filter(Boolean)
    for (const token of hubTokens) {
      if (token.length >= 2 && target.includes(token)) score += 5
    }
  }
  return score
}

function enforceExpansionSchema(expansion: ExpansionExtraction, hubs: HubNode[]): ExpansionExtraction {
  const hubLabelSet = new Set(hubs.map(h => normalizeLabel(h.label)))

  const nodes: ExpansionNode[] = []
  for (const rawNode of (expansion.nodes || [])) {
    const label = normalizeLabel(rawNode.label)
    const type = normalizeType(rawNode.type)
    if (!label || !type) continue

    const connectedToSeed = normalizeLabel(rawNode.connected_to_seed || '')
    const hubLabel = normalizeLabel(rawNode.hub_label || '')
    const selectedHub = connectedToSeed || hubLabel

    // Step2 schema 강제: spoke는 반드시 connected_to_seed 또는 hub_label 필요
    if (!selectedHub) continue

    // 허브 참조가 seed에 없으면 폐기
    if (!hubLabelSet.has(selectedHub)) continue

    nodes.push({
      label,
      type,
      connected_to_seed: selectedHub,
      hub_label: selectedHub,
    })
  }

  const validNodeKeys = new Set<string>()
  for (const hub of hubs) validNodeKeys.add(getNodeKey(hub.label, hub.type))
  for (const node of nodes) validNodeKeys.add(getNodeKey(node.label, node.type))

  const edges: GraphEdge[] = []
  for (const edge of (expansion.edges || [])) {
    const source = normalizeLabel(edge.source)
    const target = normalizeLabel(edge.target)
    const sourceType = normalizeType(edge.source_type)
    const targetType = normalizeType(edge.target_type)
    const relation = normalizeLabel(edge.relation)
    if (!source || !target || !sourceType || !targetType || !relation) continue

    if (!validNodeKeys.has(getNodeKey(source, sourceType)) || !validNodeKeys.has(getNodeKey(target, targetType))) {
      continue
    }

    edges.push({ source, source_type: sourceType, target, target_type: targetType, relation })
  }

  return { nodes, edges }
}

function ensureNoOrphanSpokes(
  hubs: HubNode[],
  extraction: GraphExtraction,
  preferredHubByNodeKey: Map<string, string>
): GraphExtraction {
  const hubKeySet = new Set(hubs.map(h => getNodeKey(h.label, h.type)))
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []

  const addEdge = (edge: GraphEdge) => {
    const serialized = `${getNodeKey(edge.source, edge.source_type)}->${getNodeKey(edge.target, edge.target_type)}:${edge.relation}`
    if (edgeSet.has(serialized)) return
    edgeSet.add(serialized)
    edges.push(edge)
  }

  for (const edge of extraction.edges || []) addEdge(edge)

  const nodes = extraction.nodes || []
  for (const node of nodes) {
    const key = getNodeKey(node.label, node.type)
    if (hubKeySet.has(key)) continue

    const hasAnyConnection = edges.some(
      (edge) => getNodeKey(edge.source, edge.source_type) === key || getNodeKey(edge.target, edge.target_type) === key
    )
    if (hasAnyConnection) continue

    const preferredHubLabel = preferredHubByNodeKey.get(key) || hubs[0]?.label
    const preferredHub = hubs.find(h => h.label === preferredHubLabel) || hubs[0]
    if (!preferredHub) continue

    addEdge({
      source: node.label,
      source_type: node.type,
      target: preferredHub.label,
      target_type: preferredHub.type,
      relation: 'relates_to',
    })
  }

  return { nodes, edges }
}

function ensureNewNodesConnectedToSeed(
  hubs: HubNode[],
  extraction: GraphExtraction,
  existingNodeKeys: Set<string>,
  preferredHubByNodeKey: Map<string, string>
): { extraction: GraphExtraction; fullyConnected: boolean } {
  const nodes = extraction.nodes || []
  const edges = [...(extraction.edges || [])]
  const nodeByKey = new Map<string, GraphNode>()
  for (const node of nodes) nodeByKey.set(getNodeKey(node.label, node.type), node)

  const adjacency = new Map<string, Set<string>>()
  const addAdj = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }

  for (const edge of edges) {
    addAdj(getNodeKey(edge.source, edge.source_type), getNodeKey(edge.target, edge.target_type))
  }

  const queue: string[] = []
  const visited = new Set<string>()
  for (const hub of hubs) {
    const key = getNodeKey(hub.label, hub.type)
    queue.push(key)
    visited.add(key)
  }

  while (queue.length) {
    const current = queue.shift()!
    for (const next of adjacency.get(current) || []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }

  const newNodeKeys = nodes
    .map(node => getNodeKey(node.label, node.type))
    .filter(key => !existingNodeKeys.has(key))

  for (const key of newNodeKeys) {
    if (visited.has(key)) continue

    const node = nodeByKey.get(key)
    if (!node || hubs.length === 0) continue
    const preferredHubLabel = preferredHubByNodeKey.get(key) || hubs[0].label
    const hub = hubs.find(h => h.label === preferredHubLabel) || hubs[0]

    edges.push({
      source: node.label,
      source_type: node.type,
      target: hub.label,
      target_type: hub.type,
      relation: 'relates_to',
    })
    addAdj(key, getNodeKey(hub.label, hub.type))
    visited.add(key)
  }

  const fullyConnected = newNodeKeys.every(key => visited.has(key))
  return { extraction: { nodes, edges }, fullyConnected }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const admin = getSupabaseAdmin()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { text, source_info, context_summary } = await req.json()
    if (!text) throw new Error('text required')

    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const coupleId = membership.couple_id

    const { data: existingNodes } = await admin
      .from('graph_nodes')
      .select('label, type, weight')
      .eq('couple_id', coupleId)
      .order('weight', { ascending: false })
      .limit(200)

    let contextBlock = ''
    if (context_summary) {
      contextBlock = `\n\n## 이전 대화 맥락 요약\n${context_summary}\n위 맥락을 참고하여 새 대화에서 나온 요소들이 기존 맥락과 연결되도록 하세요.`
    }

    // Step 1: Seed Hub extraction (1~2 중심 허브)
    const seed = await chatCompletionJSON<SeedExtraction>([
      {
        role: 'system',
        content: `커플 대화에서 이번 대화를 대표하는 중심 허브(seed)만 추출하세요.

규칙:
1) 허브는 최대 2개, 최소 0개.
2) 허브 타입은 event|plan|topic 중 하나만 허용.
3) 허브는 대화 단위를 대표하는 중심 개념이어야 함.
4) 동일 개념이 이미 존재한다면 기존 라벨과 동일한 표기를 우선 사용.

응답 JSON:
{
  "hubs": [{"label": "허브명", "type": "event|plan|topic"}]
}`,
      },
      { role: 'user', content: `${text}${contextBlock}` },
    ], { temperature: 0.2 })

    const hubs = (seed.hubs || [])
      .map(hub => ({ label: normalizeLabel(hub.label), type: hub.type }))
      .filter(hub => hub.label && ALLOWED_HUB_TYPES.includes(hub.type))
      .slice(0, 2)

    if (hubs.length === 0) {
      return new Response(JSON.stringify({ nodes_count: 0, edges_count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rankedExistingNodes = (existingNodes || [])
      .map(node => ({ ...node, score: buildSimilarityScore(node.label, hubs) }))
      .sort((a, b) => (b.score - a.score) || ((b.weight || 0) - (a.weight || 0)))
      .slice(0, 80)

    const existingNodesList = rankedExistingNodes
      .map(n => `${n.label} (${n.type}, 가중치:${n.weight})`)
      .join(', ')

    const seedBlock = hubs.map(h => `- ${h.label} (${h.type})`).join('\n')
    const existingNodesBlock = existingNodesList
      ? `\n\n## 허브 중심 기존 노드 후보(우선 참조)\n${existingNodesList}\n\n중요: 기존 후보와 동일 개념이면 새 노드를 생성하지 말고 기존 label/type을 그대로 재사용하세요.`
      : ''

    const runExpansion = async (retryInstruction = ''): Promise<ExpansionExtraction> => {
      return await chatCompletionJSON<ExpansionExtraction>([
        {
          role: 'system',
          content: `Step 2 Expansion: Seed 허브를 중심으로 세부 노드와 관계를 추출하세요.

## Seed 허브
${seedBlock}

## 출력 규칙(강제)
1) spokes(허브가 아닌 모든 노드)는 반드시 connected_to_seed 또는 hub_label 필드를 가져야 함.
2) connected_to_seed/hub_label 값은 반드시 위 Seed 허브 label 중 하나여야 함.
3) 기존 노드 후보와 동일 개념이면 새 노드 생성 금지(기존 label/type 사용).
4) 각 spoke는 허브와 직접 또는 간접 관계를 가져야 함.

## 노드 타입
person, topic, event, emotion, habit, value, place, plan

## 관계 타입
원인됨, 관련됨, 유발함, 해결함, 선호함, 회피함, 갈등됨, 지지함, 언급함, 느낌, 계획함, 방문함, 참여함, relates_to
${existingNodesBlock}${contextBlock}

응답 JSON 스키마:
{
  "nodes": [
    {
      "label": "노드명",
      "type": "person|topic|event|emotion|habit|value|place|plan",
      "connected_to_seed": "Seed 허브 라벨 또는 생략",
      "hub_label": "Seed 허브 라벨 또는 생략"
    }
  ],
  "edges": [
    {
      "source": "노드명",
      "source_type": "노드타입",
      "target": "노드명",
      "target_type": "노드타입",
      "relation": "관계타입"
    }
  ]
}

주의: spokes에서 connected_to_seed와 hub_label 둘 다 누락되면 해당 노드는 무효입니다.${retryInstruction}`,
        },
        { role: 'user', content: text },
      ], { temperature: 0.3 })
    }

    let expanded = await runExpansion()
    let validated = enforceExpansionSchema(expanded, hubs)

    // 스키마 미준수 시 1회 재시도
    if ((expanded.nodes || []).length > 0 && validated.nodes.length === 0) {
      expanded = await runExpansion('\n재시도 지시: 이전 응답에서 spoke의 connected_to_seed/hub_label 누락이 있었으니 이번에는 모든 spoke에 필수로 채우세요.')
      validated = enforceExpansionSchema(expanded, hubs)
    }

    const preferredHubByNodeKey = new Map<string, string>()
    for (const node of validated.nodes) {
      preferredHubByNodeKey.set(getNodeKey(node.label, node.type), node.hub_label || node.connected_to_seed || hubs[0].label)
    }

    const extractionNodes: GraphNode[] = [
      ...hubs,
      ...validated.nodes.map(node => ({ label: node.label, type: node.type })),
    ]

    const dedupNodeMap = new Map<string, GraphNode>()
    for (const node of extractionNodes) {
      dedupNodeMap.set(getNodeKey(node.label, node.type), node)
    }

    let extraction: GraphExtraction = {
      nodes: [...dedupNodeMap.values()],
      edges: validated.edges || [],
    }

    // 후처리: orphan spoke 제거/자동 연결(relates_to)로 orphan 0 보장
    extraction = ensureNoOrphanSpokes(hubs, extraction, preferredHubByNodeKey)

    const existingNodeKeySet = new Set((existingNodes || []).map(n => getNodeKey(n.label, n.type)))

    // 최종 저장 전 연결성 검사(신규 노드 기준). 실패 시 자동 보정 후에도 실패하면 재요청
    let connectivity = ensureNewNodesConnectedToSeed(hubs, extraction, existingNodeKeySet, preferredHubByNodeKey)
    extraction = connectivity.extraction

    if (!connectivity.fullyConnected) {
      const retryExpanded = await runExpansion('\n재요청 지시: 신규 노드가 seed 허브와 연결되지 않았습니다. 모든 신규 노드가 seed와 연결되도록 edge를 반드시 포함하세요.')
      const retryValidated = enforceExpansionSchema(retryExpanded, hubs)
      const retryNodeMap = new Map<string, GraphNode>()
      for (const hub of hubs) retryNodeMap.set(getNodeKey(hub.label, hub.type), hub)
      for (const node of retryValidated.nodes) retryNodeMap.set(getNodeKey(node.label, node.type), { label: node.label, type: node.type })

      extraction = {
        nodes: [...retryNodeMap.values()],
        edges: retryValidated.edges,
      }

      extraction = ensureNoOrphanSpokes(hubs, extraction, preferredHubByNodeKey)
      connectivity = ensureNewNodesConnectedToSeed(hubs, extraction, existingNodeKeySet, preferredHubByNodeKey)
      extraction = connectivity.extraction
    }

    const nodeIds: Record<string, string> = {}
    const newlyCreatedNodeKeys = new Set<string>()

    for (const node of (extraction.nodes || [])) {
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
        nodeIds[getNodeKey(node.label, node.type)] = existing.id
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
          const key = getNodeKey(node.label, node.type)
          nodeIds[key] = data.id
          newlyCreatedNodeKeys.add(key)
        }
      }
    }

    for (const edge of (extraction.edges || [])) {
      for (const side of ['source', 'target'] as const) {
        const label = edge[side]
        const type = side === 'source' ? edge.source_type : edge.target_type
        const key = getNodeKey(label, type)
        if (!nodeIds[key]) {
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

    let edgesCreated = 0
    for (const edge of (extraction.edges || [])) {
      const sourceId = nodeIds[getNodeKey(edge.source, edge.source_type)]
      const targetId = nodeIds[getNodeKey(edge.target, edge.target_type)]
      if (!sourceId || !targetId) continue

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
      seed_hubs_count: hubs.length,
      nodes_count: extraction.nodes?.length || 0,
      new_nodes_count: newlyCreatedNodeKeys.size,
      edges_count: edgesCreated,
      connectivity_ok: connectivity.fullyConnected,
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
