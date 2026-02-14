<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useCoupleStore } from '../stores/couple'
import PageHeader from '../components/common/PageHeader.vue'
import CardWrapper from '../components/common/CardWrapper.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'

const couple = useCoupleStore()
const router = useRouter()
const days = ref([])
const loading = ref(true)

onMounted(async () => {
  if (!couple.coupleId) return
  const { data } = await supabase
    .from('conversation_days')
    .select('*, messages(count)')
    .eq('couple_id', couple.coupleId)
    .eq('archived', true)
    .order('date', { ascending: false })
  days.value = data || []
  loading.value = false
})

function editTitle(day) {
  const newTitle = prompt('제목을 입력하세요:', day.title_override || day.title || '')
  if (newTitle !== null) {
    supabase.from('conversation_days')
      .update({ title_override: newTitle })
      .eq('id', day.id)
      .then(() => { day.title_override = newTitle })
  }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-2 px-4 pt-4 pb-2">
      <button @click="router.back()" class="text-pink-400 hover:text-pink-600">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1 class="text-xl font-bold text-rose-800">아카이브</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <LoadingSpinner v-if="loading" />
      <div v-else-if="days.length === 0" class="text-center text-pink-300 py-12">
        <div class="text-2xl mb-2">&#x2764;</div>
        아카이브가 비어있습니다
      </div>
      <CardWrapper v-for="day in days" :key="day.id"
        class="cursor-pointer hover:shadow-lg transition-shadow" @click="router.push(`/archive/${day.id}`)">
        <div class="flex justify-between items-start">
          <div>
            <p class="text-xs text-pink-400">{{ formatDate(day.date) }}</p>
            <h3 class="font-bold text-rose-800 mt-1">{{ day.title_override || day.title || day.date }}</h3>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs bg-pink-50 text-pink-400 px-2 py-0.5 rounded-full border border-pink-200">archived</span>
            <button @click.stop="editTitle(day)" class="text-xs text-pink-400 hover:text-pink-600">수정</button>
          </div>
        </div>
        <p class="text-xs text-pink-400/70 mt-2">
          {{ day.messages?.[0]?.count || 0 }}개 메시지
        </p>
      </CardWrapper>
    </div>
  </div>
</template>
