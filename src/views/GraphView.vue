<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useGraphStore } from '../stores/graph'
import { useCoupleStore } from '../stores/couple'
import { api } from '../lib/api'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'
import GraphCanvas from '../components/graph/GraphCanvas.vue'

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
  // Trigger zoom-to-node in the canvas
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
  person: '#ec4899',
  topic: '#a78bfa',
  event: '#fb923c',
  emotion: '#f87171',
  habit: '#34d399',
  value: '#60a5fa',
  place: '#22d3ee',
  plan: '#fbbf24'
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

    <div v-if="!couple.isConnected" class="flex-1 flex items-center justify-center text-pink-400">
      커플 연동 후 이용 가능합니다
    </div>

    <template v-else>
      <!-- Search -->
      <div class="px-4 pb-2 flex gap-2">
        <div class="flex-1 relative">
          <input v-model="searchInput" @input="onSearch"
            placeholder="키워드로 검색... (노드를 찾아 확대합니다)"
            class="w-full bg-white text-rose-800 text-sm rounded-xl px-4 py-2.5 border border-pink-200 focus:border-pink-400 focus:outline-none shadow-sm" />
          <span v-if="searchInput && searchResultCount > 0"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-pink-400 bg-pink-50 px-2 py-0.5 rounded-full">
            {{ searchResultCount }}개 발견
          </span>
        </div>
        <button @click="showAnalysis = !showAnalysis"
          class="text-xs bg-purple-50 text-purple-500 px-3 py-2 rounded-xl hover:bg-purple-100 transition-colors font-medium border border-purple-200">
          분석
        </button>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-purple-50/60 border border-purple-200 rounded-xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 왜 이런 감정이 생겼는지?"
            class="flex-1 bg-white text-rose-800 text-sm rounded-lg px-3 py-2 border border-purple-200 focus:border-purple-400 focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-purple-400 hover:bg-purple-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-purple-400 text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-rose-700 whitespace-pre-wrap">{{ analysisResult.answer }}</div>
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
      <div class="flex-1 relative rounded-2xl mx-4 mb-2 overflow-hidden border border-pink-100/60 bg-gradient-to-br from-white via-pink-50/20 to-sky-50/30">
        <LoadingSpinner v-if="graph.loading" />
        <GraphCanvas
          v-else
          ref="graphCanvasRef"
          :nodes="graph.nodes"
          :edges="graph.edges"
          :search-query="graph.searchQuery"
          @node-click="onNodeClick"
        />
        <!-- Empty state -->
        <div v-if="!graph.loading && graph.nodes.length === 0"
          class="absolute inset-0 flex flex-col items-center justify-center text-pink-300">
          <div class="text-3xl mb-2">&#x2764;</div>
          <p class="text-sm">아직 그래프 데이터가 없어요</p>
          <p class="text-xs mt-1 text-pink-200">채팅에서 대화하면 자동으로 생성됩니다</p>
        </div>
      </div>

      <!-- Selected node info -->
      <div v-if="selectedNode" class="mx-4 mb-2 bg-white border border-pink-100/60 rounded-xl p-4 card-cute">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-medium"
              :style="{ backgroundColor: (nodeTypeColors[selectedNode.type] || '#888') + '20', color: nodeTypeColors[selectedNode.type] }">
              {{ nodeTypeLabels[selectedNode.type] || selectedNode.type }}
            </span>
            <h3 class="text-lg font-bold text-rose-800 mt-1">{{ selectedNode.label }}</h3>
            <p class="text-sm text-pink-400/70">weight: {{ selectedNode.weight }}</p>
          </div>
          <button @click="selectedNode = null" class="text-pink-300 hover:text-pink-500 text-lg">&times;</button>
        </div>
        <div v-if="graph.getRelatedEdges(selectedNode.id).length" class="mt-3 space-y-1">
          <p class="text-xs text-pink-400/70">관련 관계:</p>
          <div v-for="edge in graph.getRelatedEdges(selectedNode.id)" :key="edge.id"
            class="text-xs text-rose-700 bg-pink-50/60 rounded-lg px-2.5 py-1.5">
            {{ edge.relation }} (weight: {{ edge.weight }})
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
