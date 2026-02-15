import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

type GraphNode = {
  id: string
  label: string
  type: string
  weight: number
}

type GraphEdge = {
  id: string
  relation: string
  weight: number
  source_node_id: string
  target_node_id: string
  source_node?: { label?: string; type?: string } | null
  target_node?: { label?: string; type?: string } | null
}

const KOREAN_STOPWORDS = new Set([
  '그리고', '그런데', '그래서', '정말', '요즘', '우리', '제가', '너무', '관련', '대해', '대한', '무엇', '어떻게', '왜', '언제', '에서', '에게', '하다', '했던', '하는', '해서', '같아', '같은', '정도', '때문', '있어', '있을', '없어', '없을',
])

function extractKeywordSeeds(question: string): string[] {
  const clean = question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
  return [...new Set(
    clean
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !KOREAN_STOPWORDS.has(token))
      .slice(0, 12),
  )]
}

function scoreSeedNode(node: GraphNode, terms: string[]): number {
  const label = node.label.toLowerCase()
  const matchScore = terms.reduce((acc, term) => {
    if (label === term) return acc + 3
    if (label.includes(term)) return acc + 2
    if (term.includes(label)) return acc + 1
    return acc
  }, 0)

  if (matchScore === 0) return 0
  return matchScore * 10 + Math.min(node.weight, 20)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { question } = await req.json()
    if (!question) throw new Error('question required')

    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const coupleId = membership.couple_id

    const keywordSeeds = extractKeywordSeeds(question)
    const llmSeedExtraction = await chatCompletionJSON<{ seed_terms: string[] }>([
      {
        role: 'system',
        content: `질문에서 관계 그래프 탐색용 핵심 명사/개체만 추출하세요. 반드시 JSON으로 응답:
{
  "seed_terms": ["용어1", "용어2"]
}
규칙: 최대 8개, 중복 금지, 짧은 명사 위주.`,
      },
      { role: 'user', content: question },
    ], { temperature: 0.1, max_tokens: 180 })

    const llmSeeds = (llmSeedExtraction.seed_terms || [])
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length >= 2)
      .slice(0, 8)

    const seedTerms = [...new Set([...keywordSeeds, ...llmSeeds])]

    const candidateNodesMap = new Map<string, GraphNode>()
    for (const term of seedTerms.slice(0, 12)) {
      const { data: partialMatches } = await supabase
        .from('graph_nodes')
        .select('id, label, type, weight')
        .eq('couple_id', coupleId)
        .ilike('label', `%${term}%`)
        .order('weight', { ascending: false })
        .limit(10)

      for (const node of (partialMatches || [])) {
        candidateNodesMap.set(node.id, node as GraphNode)
      }
    }

    const seedNodes = [...candidateNodesMap.values()]
      .map((node) => ({ node, score: scoreSeedNode(node, seedTerms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.node)

    const contextParts: string[] = []

    const { data: summaries } = await supabase
      .from('daily_summaries')
      .select('date, title, diary_text, mood, highlights')
      .eq('couple_id', coupleId)
      .order('date', { ascending: false })
      .limit(14)

    if (summaries?.length) {
      contextParts.push('## 최근 일기 요약\n' + summaries.map(s =>
        `- ${s.date}: ${s.title} | ${s.diary_text?.slice(0, 100)}...`
      ).join('\n'))
    }

    let traversedEdges: GraphEdge[] = []
    let contextStrategy: 'subgraph' | 'topk_fallback' = 'topk_fallback'

    if (seedNodes.length > 0) {
      contextStrategy = 'subgraph'

      const seedNodeIds = new Set(seedNodes.map((node) => node.id))
      const firstHopIds = [...seedNodeIds]

      const { data: hop1EdgesData } = await supabase
        .from('graph_edges')
        .select('id, relation, weight, source_node_id, target_node_id, source_node:source_node_id(label, type), target_node:target_node_id(label, type)')
        .eq('couple_id', coupleId)
        .or(`source_node_id.in.(${firstHopIds.join(',')}),target_node_id.in.(${firstHopIds.join(',')})`)
        .order('weight', { ascending: false })
        .limit(60)

      const hop1Edges = (hop1EdgesData || []) as GraphEdge[]
      const oneHopNodeIds = new Set<string>([...seedNodeIds])
      for (const edge of hop1Edges) {
        oneHopNodeIds.add(edge.source_node_id)
        oneHopNodeIds.add(edge.target_node_id)
      }

      const hop2Targets = [...oneHopNodeIds]
      let hop2Edges: GraphEdge[] = []
      if (hop2Targets.length > 0) {
        const { data: hop2EdgesData } = await supabase
          .from('graph_edges')
          .select('id, relation, weight, source_node_id, target_node_id, source_node:source_node_id(label, type), target_node:target_node_id(label, type)')
          .eq('couple_id', coupleId)
          .or(`source_node_id.in.(${hop2Targets.join(',')}),target_node_id.in.(${hop2Targets.join(',')})`)
          .order('weight', { ascending: false })
          .limit(120)

        hop2Edges = (hop2EdgesData || []) as GraphEdge[]
      }

      const traversedMap = new Map<string, GraphEdge>()
      for (const edge of [...hop1Edges, ...hop2Edges]) {
        traversedMap.set(edge.id, edge)
      }
      traversedEdges = [...traversedMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 80)

      contextParts.push('## 질의 기반 Seed 노드\n' + seedNodes.map((n) =>
        `- [${n.type}] ${n.label} (weight: ${n.weight})`
      ).join('\n'))

      if (traversedEdges.length) {
        contextParts.push('## Seed 확장 서브그래프(1~2 hop)\n' + traversedEdges.map((e) => {
          const src = e.source_node?.label || e.source_node_id
          const tgt = e.target_node?.label || e.target_node_id
          return `- ${src} --[${e.relation}]--> ${tgt} (weight: ${e.weight})`
        }).join('\n'))
      }
    }

    if (seedNodes.length === 0) {
      const { data: topNodes } = await supabase
        .from('graph_nodes')
        .select('label, type, weight')
        .eq('couple_id', coupleId)
        .order('weight', { ascending: false })
        .limit(20)

      const { data: topEdges } = await supabase
        .from('graph_edges')
        .select('relation, weight, source_node:source_node_id(label, type), target_node:target_node_id(label, type)')
        .eq('couple_id', coupleId)
        .order('weight', { ascending: false })
        .limit(20)

      if (topNodes?.length) {
        contextParts.push('## 주요 그래프 노드 (Fallback)\n' + topNodes.map(n =>
          `- [${n.type}] ${n.label} (weight: ${n.weight})`
        ).join('\n'))
      }

      if (topEdges?.length) {
        contextParts.push('## 주요 관계 (Fallback)\n' + topEdges.map(e => {
          const src = (e as any).source_node
          const tgt = (e as any).target_node
          return `- ${src?.label} --[${e.relation}]--> ${tgt?.label} (weight: ${e.weight})`
        }).join('\n'))
      }
    }

    const context = contextParts.join('\n\n')

    const result = await chatCompletionJSON<{
      answer: string
      referenced_nodes: string[]
      referenced_edges: string[]
      referenced_days: string[]
      suggested_actions: string[]
    }>([
      {
        role: 'system',
        content: `당신은 커플 관계 분석 전문가입니다. 아래 컨텍스트를 바탕으로 사용자의 질문에 따뜻하지만 정직하게 답변하세요.

${context}

반드시 JSON으로 응답:
{
  "answer": "상세한 답변 (한국어)",
  "referenced_nodes": ["관련 노드 label 목록"],
  "referenced_edges": ["관련 관계 설명 목록"],
  "referenced_days": ["관련 날짜 목록 YYYY-MM-DD"],
  "suggested_actions": ["제안 사항 목록"]
}`
      },
      { role: 'user', content: question }
    ], { temperature: 0.7, max_tokens: 2000 })

    return new Response(JSON.stringify({
      ...result,
      context_strategy: contextStrategy,
      seed_nodes: seedNodes.map((node) => ({
        id: node.id,
        label: node.label,
        type: node.type,
        weight: node.weight,
      })),
      traversed_edges: traversedEdges.map((edge) => ({
        id: edge.id,
        relation: edge.relation,
        weight: edge.weight,
        source_node_id: edge.source_node_id,
        target_node_id: edge.target_node_id,
        source_label: edge.source_node?.label || null,
        target_label: edge.target_node?.label || null,
      })),
      used_seed_terms: seedTerms,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, answer: '분석 중 오류가 발생했습니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
