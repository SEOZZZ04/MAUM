<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDiaryStore } from '../stores/diary'
import { useCoupleStore } from '../stores/couple'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import PageHeader from '../components/common/PageHeader.vue'
import CardWrapper from '../components/common/CardWrapper.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'

const diary = useDiaryStore()
const couple = useCoupleStore()
const router = useRouter()

const activeTab = ref('diary')
const generating = ref(false)
const uploadingAudio = ref(false)
const uploadProgress = ref('')

onMounted(async () => {
  if (couple.isConnected) {
    await Promise.all([diary.fetchSummaries(), diary.fetchCallLogs()])
  }
})

async function generateToday() {
  generating.value = true
  try {
    // Use KST date
    const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000)
    const today = kstNow.toISOString().split('T')[0]
    await diary.generateSummary(today)
    await diary.fetchSummaries()
  } catch (e) {
    alert('일기 생성 실패: ' + e.message)
  }
  generating.value = false
}

async function uploadCallAudio(event) {
  const file = event.target.files?.[0]
  if (!file) return

  uploadingAudio.value = true
  uploadProgress.value = '파일 업로드 중...'

  try {
    const path = `${couple.coupleId}/calls/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage.from('uploads').upload(path, file)
    if (uploadError) throw uploadError

    uploadProgress.value = '업로드 기록 생성 중...'
    const { data: upload } = await supabase.from('uploads').insert({
      couple_id: couple.coupleId,
      user_id: (await supabase.auth.getUser()).data.user.id,
      type: 'call_audio',
      storage_path: path
    }).select().single()

    uploadProgress.value = '통화 분석 중...'
    await api.analyzeCallAudio(upload.id)
    await diary.fetchCallLogs()
    uploadProgress.value = '완료!'
  } catch (e) {
    uploadProgress.value = '오류: ' + e.message
  }
  uploadingAudio.value = false
}

function editTitle(summary) {
  const newTitle = prompt('제목을 입력하세요:', summary.title_override || summary.title || '')
  if (newTitle !== null) {
    diary.updateSummaryTitle(summary.id, newTitle)
  }
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <PageHeader title="일기 & 통화" subtitle="대화의 기록을 돌아봅니다" />

    <div v-if="!couple.isConnected" class="flex-1 flex items-center justify-center text-pink-400">
      커플 연동 후 이용 가능합니다
    </div>

    <template v-else>
      <!-- Tabs -->
      <div class="px-4 flex gap-2 mb-3">
        <button @click="activeTab = 'diary'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="activeTab === 'diary' ? 'bg-pink-400 text-white shadow-sm shadow-pink-200' : 'bg-white text-pink-500 border border-pink-200'">
          일기
        </button>
        <button @click="activeTab = 'calls'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="activeTab === 'calls' ? 'bg-sky-400 text-white shadow-sm shadow-sky-200' : 'bg-white text-sky-500 border border-sky-200'">
          통화 기록
        </button>
      </div>

      <!-- Diary Tab -->
      <div v-if="activeTab === 'diary'" class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <button @click="generateToday" :disabled="generating"
          class="w-full bg-gradient-to-r from-pink-400 to-rose-400 hover:from-pink-500 hover:to-rose-500 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 shadow-md shadow-pink-200">
          {{ generating ? '생성 중...' : '오늘 일기 만들기' }}
        </button>

        <LoadingSpinner v-if="diary.loading" />
        <div v-else-if="diary.summaries.length === 0" class="text-center text-pink-300 py-12">
          <div class="text-2xl mb-2">&#x2764;</div>
          아직 일기가 없습니다
        </div>

        <CardWrapper v-for="s in diary.summaries" :key="s.id">
          <div class="flex justify-between items-start mb-2">
            <div>
              <p class="text-xs text-pink-400">{{ formatDate(s.date) }}</p>
              <h3 class="font-bold text-rose-800">{{ s.title_override || s.title || '제목 없음' }}</h3>
            </div>
            <button @click="editTitle(s)" class="text-xs text-pink-400 hover:text-pink-600">수정</button>
          </div>
          <p class="text-sm text-rose-700/80 line-clamp-3">{{ s.diary_text }}</p>
          <div v-if="s.mood" class="mt-2 flex gap-1 flex-wrap">
            <span v-for="(val, key) in s.mood" :key="key"
              class="text-xs bg-pink-50 rounded-full px-2 py-0.5 text-pink-500">
              {{ key }}: {{ val }}
            </span>
          </div>
        </CardWrapper>
      </div>

      <!-- Calls Tab -->
      <div v-if="activeTab === 'calls'" class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <label class="block w-full bg-gradient-to-r from-sky-400 to-blue-400 hover:from-sky-500 hover:to-blue-500 text-white font-semibold py-3 rounded-xl text-center cursor-pointer transition-all shadow-md shadow-sky-200">
          {{ uploadingAudio ? uploadProgress : '통화 음성 업로드' }}
          <input type="file" accept="audio/*" @change="uploadCallAudio" class="hidden" :disabled="uploadingAudio" />
        </label>

        <div v-if="diary.callLogs.length === 0" class="text-center text-sky-300 py-12">
          <div class="text-2xl mb-2">&#x2764;</div>
          통화 기록이 없습니다
        </div>

        <CardWrapper v-for="call in diary.callLogs" :key="call.id"
          class="cursor-pointer" @click="router.push(`/diary/call/${call.id}`)">
          <p class="text-xs text-sky-400">{{ formatDate(call.occurred_at) }}</p>
          <h3 class="font-bold text-rose-800 mt-1">{{ call.summary?.slice(0, 60) || '통화 기록' }}...</h3>
          <div v-if="call.keywords" class="mt-2 flex flex-wrap gap-1">
            <span v-for="kw in (Array.isArray(call.keywords) ? call.keywords.slice(0, 5) : [])" :key="kw"
              class="text-xs bg-sky-50 text-sky-500 rounded-full px-2 py-0.5">
              {{ kw }}
            </span>
          </div>
        </CardWrapper>
      </div>
    </template>
  </div>
</template>
