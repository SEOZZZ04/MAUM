<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api'
import CardWrapper from '../components/common/CardWrapper.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'

const router = useRouter()
const metrics = ref(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    metrics.value = await api.getAdminMetrics()
  } catch (e) {
    error.value = e.message
  }
  loading.value = false
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="flex items-center gap-2 px-4 pt-4 pb-2">
      <button @click="router.push('/settings')" class="text-pink-400 hover:text-pink-600">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1 class="text-xl font-bold text-rose-900">관리자 대시보드</h1>
    </div>

    <div class="px-4 pb-8 space-y-4">
      <LoadingSpinner v-if="loading" />
      <p v-else-if="error" class="text-red-400">{{ error }}</p>

      <template v-else-if="metrics">
        <!-- Overview -->
        <div class="grid grid-cols-2 gap-3">
          <CardWrapper>
            <p class="text-xs text-rose-500/70">전체 유저</p>
            <p class="text-2xl font-bold text-rose-900">{{ metrics.total_users || 0 }}</p>
          </CardWrapper>
          <CardWrapper>
            <p class="text-xs text-rose-500/70">전체 커플</p>
            <p class="text-2xl font-bold text-rose-500">{{ metrics.total_couples || 0 }}</p>
          </CardWrapper>
          <CardWrapper>
            <p class="text-xs text-rose-500/70">DAU (오늘)</p>
            <p class="text-2xl font-bold text-green-500">{{ metrics.dau || 0 }}</p>
          </CardWrapper>
          <CardWrapper>
            <p class="text-xs text-rose-500/70">WAU (7일)</p>
            <p class="text-2xl font-bold text-blue-500">{{ metrics.wau || 0 }}</p>
          </CardWrapper>
        </div>

        <!-- Couple details -->
        <h2 class="text-lg font-bold text-rose-900 mt-4">커플별 상세</h2>
        <CardWrapper v-for="c in (metrics.couples || [])" :key="c.couple_id">
          <div class="flex justify-between items-start">
            <div>
              <h3 class="font-bold text-rose-900">{{ c.members?.join(', ') || 'N/A' }}</h3>
              <p class="text-xs text-rose-500/70">커플 ID: {{ c.couple_id?.slice(0, 8) }}...</p>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 mt-3">
            <div class="text-center">
              <p class="text-lg font-bold text-rose-900">{{ c.message_count || 0 }}</p>
              <p class="text-xs text-rose-500/70">메시지</p>
            </div>
            <div class="text-center">
              <p class="text-lg font-bold text-rose-900">{{ c.diary_count || 0 }}</p>
              <p class="text-xs text-rose-500/70">일기</p>
            </div>
            <div class="text-center">
              <p class="text-lg font-bold text-rose-900">{{ c.node_count || 0 }}</p>
              <p class="text-xs text-rose-500/70">그래프 노드</p>
            </div>
          </div>
        </CardWrapper>
      </template>
    </div>
  </div>
</template>
