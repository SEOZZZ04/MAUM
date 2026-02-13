import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { chatCompletionJSON } from '../_shared/openai.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = getSupabaseClient(req)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('Unauthorized')

    const { question } = await req.json()
    if (!question) throw new Error('question required')

    // Get couple
    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .single()
    if (!membership) throw new Error('커플이 연동되지 않았습니다')

    const coupleId = membership.couple_id

    // Gather context: recent summaries
    const { data: summaries } = await supabase
      .from('daily_summaries')
      .select('date, title, diary_text, mood, highlights')
      .eq('couple_id', coupleId)
      .order('date', { ascending: false })
      .limit(14)

    // Gather context: top graph nodes
    const { data: topNodes } = await supabase
      .from('graph_nodes')
      .select('label, type, weight')
      .eq('couple_id', coupleId)
      .order('weight', { ascending: false })
      .limit(20)

    // Gather context: top graph edges
    const { data: topEdges } = await supabase
      .from('graph_edges')
      .select('relation, weight, source_node:source_node_id(label, type), target_node:target_node_id(label, type)')
      .eq('couple_id', coupleId)
      .order('weight', { ascending: false })
      .limit(20)

    const contextParts: string[] = []

    if (summaries?.length) {
      contextParts.push('## 최근 일기 요약\n' + summaries.map(s =>
        `- ${s.date}: ${s.title} | ${s.diary_text?.slice(0, 100)}...`
      ).join('\n'))
    }

    if (topNodes?.length) {
      contextParts.push('## 주요 그래프 노드\n' + topNodes.map(n =>
        `- [${n.type}] ${n.label} (weight: ${n.weight})`
      ).join('\n'))
    }

    if (topEdges?.length) {
      contextParts.push('## 주요 관계\n' + topEdges.map(e => {
        const src = (e as any).source_node
        const tgt = (e as any).target_node
        return `- ${src?.label} --[${e.relation}]--> ${tgt?.label} (weight: ${e.weight})`
      }).join('\n'))
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

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, answer: '분석 중 오류가 발생했습니다.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
