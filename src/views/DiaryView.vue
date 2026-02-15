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

// Edit state
const editingId = ref(null)
const editTitle = ref('')
const editContent = ref('')
const savingEdit = ref(false)

// Delete state
const deletingId = ref(null)

onMounted(async () => {
  if (couple.isConnected) {
    await Promise.all([diary.fetchSummaries(), diary.fetchCallLogs()])
  }
})

async function generateToday() {
  generating.value = true
  try {
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

function startEdit(summary) {
  editingId.value = summary.id
  editTitle.value = summary.title_override || summary.title || ''
  editContent.value = summary.diary_text || ''
}

function cancelEdit() {
  editingId.value = null
  editTitle.value = ''
  editContent.value = ''
}

async function saveEdit(summary) {
  savingEdit.value = true
  try {
    await diary.updateSummaryTitle(summary.id, editTitle.value)
    await diary.updateSummaryContent(summary.id, editContent.value)
    editingId.value = null
  } catch (e) {
    alert('저장 실패: ' + e.message)
  }
  savingEdit.value = false
}

async function confirmDelete(summary) {
  if (!confirm(`"${summary.title_override || summary.title || summary.date}" 일기를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return
  deletingId.value = summary.id
  try {
    await diary.deleteSummary(summary.id)
  } catch (e) {
    alert('삭제 실패: ' + e.message)
  }
  deletingId.value = null
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}
</script>

<template>
  <div class="h-full flex flex-col">
    <PageHeader title="일기 & 통화" subtitle="대화의 기록을 돌아봅니다" />

    <div v-if="!couple.isConnected" class="flex-1 flex items-center justify-center text-[#b5a48e]">
      커플 연동 후 이용 가능합니다
    </div>

    <template v-else>
      <!-- Tabs -->
      <div class="px-4 flex gap-2 mb-3">
        <button @click="activeTab = 'diary'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="activeTab === 'diary' ? 'bg-[#c9a96e] text-white shadow-sm shadow-[#c9a96e]/20' : 'bg-[#fffcf7] text-[#c9a96e] border border-[#ecdcc5]'">
          일기
        </button>
        <button @click="activeTab = 'calls'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="activeTab === 'calls' ? 'bg-[#d4a574] text-white shadow-sm shadow-[#d4a574]/20' : 'bg-[#fffcf7] text-[#d4a574] border border-[#ecdcc5]'">
          통화 기록
        </button>
      </div>

      <!-- Diary Tab -->
      <div v-if="activeTab === 'diary'" class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <button @click="generateToday" :disabled="generating"
          class="w-full bg-gradient-to-r from-[#c9a96e] to-[#d4a574] hover:from-[#b08d4f] hover:to-[#c08a56] text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 shadow-md shadow-[#c9a96e]/20">
          {{ generating ? '생성 중...' : '오늘 일기 만들기' }}
        </button>

        <LoadingSpinner v-if="diary.loading" />
        <div v-else-if="diary.summaries.length === 0" class="text-center text-[#d4bfa0] py-12">
          <div class="text-2xl mb-2">&#x2764;</div>
          아직 일기가 없습니다
        </div>

        <CardWrapper v-for="s in diary.summaries" :key="s.id">
          <!-- View mode -->
          <template v-if="editingId !== s.id">
            <div class="flex justify-between items-start mb-2">
              <div>
                <p class="text-xs text-[#c9a96e]">{{ formatDate(s.date) }}</p>
                <h3 class="font-bold text-[#5d4e37] font-display">{{ s.title_override || s.title || '제목 없음' }}</h3>
              </div>
              <div class="flex gap-1.5">
                <button @click="startEdit(s)" class="text-xs text-[#c9a96e] hover:text-[#b08d4f] transition-colors">수정</button>
                <button @click="confirmDelete(s)" :disabled="deletingId === s.id"
                  class="text-xs text-red-400 hover:text-red-500 transition-colors disabled:opacity-50">
                  {{ deletingId === s.id ? '삭제중...' : '삭제' }}
                </button>
              </div>
            </div>
            <p class="text-sm text-[#5d4e37]/80 line-clamp-3">{{ s.diary_text }}</p>
            <div v-if="s.mood" class="mt-2 flex gap-1 flex-wrap">
              <span v-for="(val, key) in s.mood" :key="key"
                class="text-xs bg-[#f5ead6] rounded-full px-2 py-0.5 text-[#8a7560]">
                {{ key }}: {{ val }}
              </span>
            </div>
          </template>

          <!-- Edit mode -->
          <template v-else>
            <div class="space-y-3">
              <div>
                <label class="text-xs text-[#b5a48e] mb-1 block">제목</label>
                <input v-model="editTitle"
                  class="w-full bg-[#f5ead6]/40 text-[#5d4e37] text-sm rounded-lg px-3 py-2 border border-[#ecdcc5] focus:border-[#c9a96e] focus:outline-none" />
              </div>
              <div>
                <label class="text-xs text-[#b5a48e] mb-1 block">내용</label>
                <textarea v-model="editContent" rows="5"
                  class="w-full bg-[#f5ead6]/40 text-[#5d4e37] text-sm rounded-lg px-3 py-2 border border-[#ecdcc5] focus:border-[#c9a96e] focus:outline-none resize-none" />
              </div>
              <div class="flex gap-2 justify-end">
                <button @click="cancelEdit"
                  class="text-xs bg-[#ecdcc5] text-[#8a7560] px-4 py-2 rounded-lg hover:bg-[#e0d0b5] transition-colors font-medium">
                  취소
                </button>
                <button @click="saveEdit(s)" :disabled="savingEdit"
                  class="text-xs bg-[#c9a96e] hover:bg-[#b08d4f] text-white px-4 py-2 rounded-lg transition-colors font-medium disabled:opacity-50">
                  {{ savingEdit ? '저장 중...' : '저장' }}
                </button>
              </div>
            </div>
          </template>
        </CardWrapper>
      </div>

      <!-- Calls Tab -->
      <div v-if="activeTab === 'calls'" class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <label class="block w-full bg-gradient-to-r from-[#d4a574] to-[#c08a56] hover:from-[#c08a56] hover:to-[#b08d4f] text-white font-semibold py-3 rounded-xl text-center cursor-pointer transition-all shadow-md shadow-[#d4a574]/20">
          {{ uploadingAudio ? uploadProgress : '통화 음성 업로드' }}
          <input type="file" accept="audio/*" @change="uploadCallAudio" class="hidden" :disabled="uploadingAudio" />
        </label>

        <div v-if="diary.callLogs.length === 0" class="text-center text-[#d4bfa0] py-12">
          <div class="text-2xl mb-2">&#x2764;</div>
          통화 기록이 없습니다
        </div>

        <CardWrapper v-for="call in diary.callLogs" :key="call.id"
          class="cursor-pointer" @click="router.push(`/diary/call/${call.id}`)">
          <p class="text-xs text-[#d4a574]">{{ formatDate(call.occurred_at) }}</p>
          <h3 class="font-bold text-[#5d4e37] font-display mt-1">{{ call.summary?.slice(0, 60) || '통화 기록' }}...</h3>
          <div v-if="call.keywords" class="mt-2 flex flex-wrap gap-1">
            <span v-for="kw in (Array.isArray(call.keywords) ? call.keywords.slice(0, 5) : [])" :key="kw"
              class="text-xs bg-[#faebd7] text-[#8a7560] rounded-full px-2 py-0.5">
              {{ kw }}
            </span>
          </div>
        </CardWrapper>
      </div>
    </template>
  </div>
</template>
