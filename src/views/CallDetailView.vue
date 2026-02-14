<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import CardWrapper from '../components/common/CardWrapper.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'

const props = defineProps({ callId: String })
const router = useRouter()
const call = ref(null)
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('call_logs')
    .select('*')
    .eq('id', props.callId)
    .single()
  call.value = data
  loading.value = false
})

function formatDate(d) {
  return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-2 px-4 pt-4 pb-2">
      <button @click="router.back()" class="text-amber-400 hover:text-amber-600">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1 class="text-lg font-bold text-amber-900">통화 상세</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
      <LoadingSpinner v-if="loading" />
      <template v-else-if="call">
        <CardWrapper>
          <p class="text-xs text-violet-500 mb-2">{{ formatDate(call.occurred_at) }}</p>
          <h2 class="text-lg font-bold text-amber-900 mb-3">요약</h2>
          <p class="text-sm text-amber-800/80 whitespace-pre-wrap">{{ call.summary || '요약 없음' }}</p>
        </CardWrapper>

        <CardWrapper v-if="call.timeline">
          <h2 class="text-lg font-bold text-amber-900 mb-3">대화 흐름</h2>
          <div class="space-y-2">
            <div v-for="(item, i) in call.timeline" :key="i"
              class="flex gap-3 text-sm">
              <span class="text-violet-500 font-mono text-xs mt-0.5">{{ String(i + 1).padStart(2, '0') }}</span>
              <p class="text-amber-800">{{ typeof item === 'string' ? item : item.text || JSON.stringify(item) }}</p>
            </div>
          </div>
        </CardWrapper>

        <CardWrapper v-if="call.emotions">
          <h2 class="text-lg font-bold text-amber-900 mb-3">감정 분석</h2>
          <div class="space-y-2">
            <div v-for="(val, key) in call.emotions" :key="key"
              class="flex justify-between text-sm">
              <span class="text-amber-600/70">{{ key }}</span>
              <span class="text-amber-900 font-medium">{{ val }}</span>
            </div>
          </div>
        </CardWrapper>

        <CardWrapper v-if="call.keywords?.length">
          <h2 class="text-lg font-bold text-amber-900 mb-3">키워드</h2>
          <div class="flex flex-wrap gap-2">
            <span v-for="kw in call.keywords" :key="kw"
              class="bg-violet-100 text-violet-600 text-sm px-3 py-1 rounded-full">
              {{ kw }}
            </span>
          </div>
        </CardWrapper>
      </template>
    </div>
  </div>
</template>
