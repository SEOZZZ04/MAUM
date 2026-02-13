<script setup>
import { onMounted, ref, watch } from 'vue'
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
  }
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
  topic: '#8b5cf6',
  event: '#f59e0b',
  emotion: '#ef4444',
  habit: '#10b981',
  value: '#3b82f6',
  place: '#06b6d4',
  plan: '#f97316'
}
</script>

<template>
  <div class="h-full flex flex-col">
    <PageHeader title="지식 그래프" subtitle="관계의 패턴을 시각화합니다" />

    <div v-if="!couple.isConnected" class="flex-1 flex items-center justify-center text-slate-400">
      커플 연동 후 이용 가능합니다
    </div>

    <template v-else>
      <!-- Search -->
      <div class="px-4 pb-2 flex gap-2">
        <input v-model="searchInput" @input="onSearch"
          placeholder="키워드로 검색..."
          class="flex-1 bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-pink-400 focus:outline-none" />
        <button @click="showAnalysis = !showAnalysis"
          class="text-xs bg-purple-500/20 text-purple-300 px-3 py-2 rounded-lg hover:bg-purple-500/30 transition-colors">
          분석
        </button>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-purple-900/30 border border-purple-700/50 rounded-xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 왜 이런 감정이 생겼는지?"
            class="flex-1 bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:border-purple-400 focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-purple-500 hover:bg-purple-600 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-purple-300 text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-slate-200 whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <!-- Node type legend -->
      <div class="px-4 pb-2 flex flex-wrap gap-2">
        <span v-for="(color, type) in nodeTypeColors" :key="type"
          class="text-[10px] px-2 py-0.5 rounded-full border border-slate-700"
          :style="{ color, borderColor: color + '40' }">
          {{ type }}
        </span>
      </div>

      <!-- Graph -->
      <div class="flex-1 relative">
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
      <div v-if="selectedNode" class="mx-4 mb-2 bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div class="flex justify-between items-start">
          <div>
            <span class="text-xs px-2 py-0.5 rounded-full"
              :style="{ backgroundColor: (nodeTypeColors[selectedNode.type] || '#888') + '20', color: nodeTypeColors[selectedNode.type] }">
              {{ selectedNode.type }}
            </span>
            <h3 class="text-lg font-bold mt-1">{{ selectedNode.label }}</h3>
            <p class="text-sm text-slate-400">weight: {{ selectedNode.weight }}</p>
          </div>
          <button @click="selectedNode = null" class="text-slate-400 hover:text-white">&times;</button>
        </div>
        <div v-if="graph.getRelatedEdges(selectedNode.id).length" class="mt-3 space-y-1">
          <p class="text-xs text-slate-400">관련 관계:</p>
          <div v-for="edge in graph.getRelatedEdges(selectedNode.id)" :key="edge.id"
            class="text-xs text-slate-300 bg-slate-700/50 rounded px-2 py-1">
            {{ edge.relation }} (weight: {{ edge.weight }})
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
