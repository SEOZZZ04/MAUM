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
  graph.searchNodes(searchInput.value)
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
        <input v-model="searchInput" @input="onSearch"
          placeholder="키워드로 검색..."
          class="flex-1 bg-white text-rose-900 text-sm rounded-lg px-3 py-2 border border-pink-200 focus:border-pink-400 focus:outline-none" />
        <button @click="showAnalysis = !showAnalysis"
          class="text-xs bg-purple-100 text-purple-500 px-3 py-2 rounded-lg hover:bg-purple-200 transition-colors font-medium">
          분석
        </button>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-purple-50/80 border border-purple-200 rounded-xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 왜 이런 감정이 생겼는지?"
            class="flex-1 bg-white text-rose-900 text-sm rounded-lg px-3 py-2 border border-purple-200 focus:border-purple-400 focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-purple-400 hover:bg-purple-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-purple-400 text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-rose-800 whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <!-- Node type legend -->
      <div class="px-4 pb-2 flex flex-wrap gap-2">
        <span v-for="(color, type) in nodeTypeColors" :key="type"
          class="text-[10px] px-2 py-0.5 rounded-full border"
          :style="{ color, borderColor: color + '40', backgroundColor: color + '10' }">
          {{ type }}
        </span>
      </div>

      <!-- Graph -->
      <div class="flex-1 relative rounded-2xl mx-4 mb-2 overflow-hidden border border-pink-100 bg-gradient-to-br from-pink-50/80 via-white to-sky-50/60">
        <LoadingSpinner v-if="graph.loading" />
        <GraphCanvas
          v-else
          :nodes="graph.nodes"
          :edges="graph.edges"
          :search-query="graph.searchQuery"
          @node-click="onNodeClick"
        />
      </div>

      <!-- Selected node info -->
      <div v-if="selectedNode" class="mx-4 mb-2 bg-white border border-pink-100 rounded-xl p-4 card-cute">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-xs px-2 py-0.5 rounded-full"
              :style="{ backgroundColor: (nodeTypeColors[selectedNode.type] || '#888') + '20', color: nodeTypeColors[selectedNode.type] }">
              {{ selectedNode.type }}
            </span>
            <h3 class="text-lg font-bold text-rose-900 mt-1">{{ selectedNode.label }}</h3>
            <p class="text-sm text-pink-400/70">weight: {{ selectedNode.weight }}</p>
          </div>
          <button @click="selectedNode = null" class="text-pink-300 hover:text-pink-500 text-lg">&times;</button>
        </div>
        <div v-if="graph.getRelatedEdges(selectedNode.id).length" class="mt-3 space-y-1">
          <p class="text-xs text-pink-400/70">관련 관계:</p>
          <div v-for="edge in graph.getRelatedEdges(selectedNode.id)" :key="edge.id"
            class="text-xs text-rose-800 bg-pink-50 rounded px-2 py-1">
            {{ edge.relation }} (weight: {{ edge.weight }})
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
