<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGraphStore } from '../stores/graph'
import { useCoupleStore } from '../stores/couple'
import { api } from '../lib/api'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'
import GraphCanvas from '../components/graph/GraphCanvas.vue'
import { getEdgeRelationLabel } from '../lib/graphRelations'

const graph = useGraphStore()
const couple = useCoupleStore()
const searchInput = ref('')
const selectedNode = ref(null)
const showAnalysis = ref(false)
const analysisQuestion = ref('')
const analysisResult = ref(null)
const analysisLoading = ref(false)
const graphCanvasRef = ref(null)
const searchResultCount = ref(0)

const resetLoading = ref(false)

async function resetKnowledgeGraph() {
  const confirmed = window.confirm('지식 그래프를 초기화할까요? 이 작업은 되돌릴 수 없어요.')
  if (!confirmed) return

  resetLoading.value = true
  try {
    await graph.resetGraph()
    selectedNode.value = null
    searchInput.value = ''
    searchResultCount.value = 0
  } catch (e) {
    window.alert(`그래프 초기화에 실패했어요: ${e.message}`)
  } finally {
    resetLoading.value = false
  }
}


onMounted(async () => {
  if (couple.isConnected) {
    await graph.fetchGraph()
    graph.subscribeToGraphChanges()
  }
})

onUnmounted(() => {
  graph.unsubscribeFromGraphChanges()
})

function onSearch() {
  const results = graph.searchNodes(searchInput.value)
  searchResultCount.value = results ? results.length : 0
  if (graphCanvasRef.value && searchInput.value.trim()) {
    graphCanvasRef.value.zoomToSearch(searchInput.value)
  }
}

function onNodeClick(node) {
  selectedNode.value = node
}

async function askAnalysis() {
  if (!analysisQuestion.value.trim()) return
  analysisLoading.value = true
  try {
    analysisResult.value = await api.analyzeQuestion(analysisQuestion.value)
  } catch (e) {
    analysisResult.value = { answer: '오류: ' + e.message }
  }
  analysisLoading.value = false
}

const nodeTypeColors = {
  person: '#c9a96e',
  topic: '#a78bfa',
  event: '#fb923c',
  emotion: '#f87171',
  habit: '#34d399',
  value: '#60a5fa',
  place: '#22d3ee',
  plan: '#fbbf24'
}


const nodeDataMap = computed(() => new Map(graph.nodes.map(node => [node.id, node])))

function formatEdgeRelation(edge) {
  return getEdgeRelationLabel(edge, nodeDataMap.value)
}

const nodeTypeLabels = {
  person: '사람',
  topic: '주제',
  event: '사건',
  emotion: '감정',
  habit: '습관',
  value: '가치',
  place: '장소',
  plan: '계획'
}
</script>

<template>
  <div class="h-full flex flex-col">
    <PageHeader title="지식 그래프" subtitle="관계의 패턴을 시각화합니다" />

    <div v-if="!couple.isConnected" class="flex-1 flex items-center justify-center text-[#b5a48e]">
      커플 연동 후 이용 가능합니다
    </div>

    <template v-else>
      <!-- Search -->
      <div class="px-4 pb-2 flex gap-2">
        <div class="flex-1 relative">
          <input v-model="searchInput" @input="onSearch"
            placeholder="키워드로 검색... (노드를 찾아 확대합니다)"
            class="w-full bg-[#fffcf7] text-[#5d4e37] text-sm rounded-xl px-4 py-2.5 border border-[#ecdcc5] focus:border-[#c9a96e] focus:outline-none shadow-sm" />
          <span v-if="searchInput && searchResultCount > 0"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#c9a96e] bg-[#f5ead6] px-2 py-0.5 rounded-full">
            {{ searchResultCount }}개 발견
          </span>
        </div>
        <button
          @click="resetKnowledgeGraph"
          :disabled="resetLoading || graph.loading"
          class="text-xs bg-[#f8d9d9] text-[#b85c5c] px-3 py-2 rounded-xl hover:bg-[#f3c3c3] transition-colors font-medium border border-[#efb4b4] disabled:opacity-50 disabled:cursor-not-allowed">
          {{ resetLoading ? '초기화 중...' : '그래프 초기화' }}
        </button>
        <button @click="showAnalysis = !showAnalysis"
          class="text-xs bg-[#c9b8d9]/15 text-[#8a6fa0] px-3 py-2 rounded-xl hover:bg-[#c9b8d9]/25 transition-colors font-medium border border-[#c9b8d9]/30">
          분석
        </button>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-[#c9b8d9]/10 border border-[#c9b8d9]/30 rounded-xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 왜 이런 감정이 생겼는지?"
            class="flex-1 bg-white text-[#5d4e37] text-sm rounded-lg px-3 py-2 border border-[#c9b8d9]/30 focus:border-[#c9b8d9] focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-[#c9b8d9]/60 hover:bg-[#c9b8d9]/80 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-[#8a6fa0] text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-[#5d4e37] whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <!-- Node type legend -->
      <div class="px-4 pb-2 flex flex-wrap gap-1.5">
        <span v-for="(color, type) in nodeTypeColors" :key="type"
          class="text-[10px] px-2.5 py-0.5 rounded-full border font-medium"
          :style="{ color, borderColor: color + '40', backgroundColor: color + '10' }">
          {{ nodeTypeLabels[type] || type }}
        </span>
      </div>

      <!-- Graph -->
      <div class="flex-1 relative rounded-2xl mx-4 mb-2 overflow-hidden border border-[#ecdcc5]/60 bg-gradient-to-br from-[#fffcf7] via-[#f5ead6]/20 to-[#faebd7]/30">
        <LoadingSpinner v-if="graph.loading" />
        <GraphCanvas
          v-else
          ref="graphCanvasRef"
          :nodes="graph.nodes"
          :edges="graph.edges"
          :search-query="graph.searchQuery"
          @node-click="onNodeClick"
        />
        <div v-if="!graph.loading && graph.nodes.length === 0"
          class="absolute inset-0 flex flex-col items-center justify-center text-[#d4bfa0]">
          <div class="text-3xl mb-2">&#x2764;</div>
          <p class="text-sm">아직 그래프 데이터가 없어요</p>
          <p class="text-xs mt-1 text-[#ecdcc5]">채팅에서 대화하면 자동으로 생성됩니다</p>
        </div>
      </div>

      <!-- Selected node info -->
      <div v-if="selectedNode" class="mx-4 mb-2 bg-[#fffcf7] border border-[#ecdcc5]/60 rounded-xl p-4 card-cute">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-medium"
              :style="{ backgroundColor: (nodeTypeColors[selectedNode.type] || '#888') + '20', color: nodeTypeColors[selectedNode.type] }">
              {{ nodeTypeLabels[selectedNode.type] || selectedNode.type }}
            </span>
            <h3 class="text-lg font-bold text-[#5d4e37] font-display mt-1">{{ selectedNode.label }}</h3>
            <p class="text-sm text-[#b5a48e]">가중치: {{ selectedNode.weight }}</p>
          </div>
          <button @click="selectedNode = null" class="text-[#d4bfa0] hover:text-[#8a7560] text-lg">&times;</button>
        </div>
        <div v-if="graph.getRelatedEdges(selectedNode.id).length" class="mt-3 space-y-1">
          <p class="text-xs text-[#b5a48e]">관련 관계:</p>
          <div v-for="edge in graph.getRelatedEdges(selectedNode.id)" :key="edge.id"
            class="text-xs text-[#5d4e37] bg-[#f5ead6]/60 rounded-lg px-2.5 py-1.5">
            {{ formatEdgeRelation(edge) }} (가중치: {{ edge.weight }})
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
