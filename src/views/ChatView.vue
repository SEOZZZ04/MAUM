<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat'
import { useCoupleStore } from '../stores/couple'
import { useAuthStore } from '../stores/auth'
import { api } from '../lib/api'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'

const chat = useChatStore()
const couple = useCoupleStore()
const auth = useAuthStore()
const router = useRouter()

const messageText = ref('')
const messagesContainer = ref(null)
const sending = ref(false)
const showAnalysis = ref(false)
const analysisQuestion = ref('')
const analysisResult = ref(null)
const analysisLoading = ref(false)

const isMe = (msg) => msg.sender_user_id === auth.userId

onMounted(async () => {
  if (!couple.isConnected) return
  const day = await chat.ensureTodayThread()
  if (day) {
    await chat.loadMessages(day.id)
    chat.subscribeToMessages(day.id)
    scrollToBottom()
  }
})

onUnmounted(() => {
  chat.unsubscribe()
})

watch(() => chat.messages.length, () => {
  nextTick(scrollToBottom)
})

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

async function send() {
  if (!messageText.value.trim() || sending.value) return
  const text = messageText.value.trim()
  messageText.value = ''
  sending.value = true
  try {
    await chat.sendMessage(text)
  } catch (e) {
    messageText.value = text
  }
  sending.value = false
}

async function archiveAndReset() {
  if (!confirm('오늘 대화를 아카이브하고 새로 시작할까요?')) return
  await chat.archiveToday()
  const day = await chat.ensureTodayThread()
  if (day) {
    await chat.loadMessages(day.id)
    chat.subscribeToMessages(day.id)
  }
}

async function askAnalysis() {
  if (!analysisQuestion.value.trim()) return
  analysisLoading.value = true
  try {
    analysisResult.value = await api.analyzeQuestion(analysisQuestion.value)
  } catch (e) {
    analysisResult.value = { answer: '분석 중 오류가 발생했습니다: ' + e.message }
  }
  analysisLoading.value = false
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Not connected -->
    <div v-if="!couple.isConnected" class="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div class="text-6xl mb-4">💑</div>
      <h2 class="text-xl font-bold mb-2">커플 연동이 필요해요</h2>
      <p class="text-slate-400 mb-6">설정에서 초대코드를 생성하거나 입력해주세요</p>
      <router-link to="/settings" class="bg-pink-500 hover:bg-pink-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors">
        설정으로 이동
      </router-link>
    </div>

    <!-- Chat -->
    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 class="text-lg font-bold">{{ couple.partner?.nickname || '상대방' }}과의 대화</h1>
          <p class="text-xs text-slate-400">{{ chat.todayThread?.date || '오늘' }}</p>
        </div>
        <div class="flex gap-2">
          <button @click="showAnalysis = !showAnalysis"
            class="text-xs bg-purple-500/20 text-purple-300 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 transition-colors">
            분석
          </button>
          <button @click="router.push('/archive')"
            class="text-xs bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-600 transition-colors">
            아카이브
          </button>
          <button @click="archiveAndReset"
            class="text-xs bg-rose-500/20 text-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-500/30 transition-colors">
            초기화
          </button>
        </div>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-purple-900/30 border border-purple-700/50 rounded-xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 최근 갈등 패턴이 뭐야?"
            class="flex-1 bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-600 focus:border-purple-400 focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-purple-500 hover:bg-purple-600 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-purple-300 text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-slate-200 whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <LoadingSpinner v-if="chat.loading" />
        <div v-for="msg in chat.messages" :key="msg.id"
          class="flex" :class="isMe(msg) ? 'justify-end' : 'justify-start'">
          <div class="max-w-[75%]">
            <p class="text-[10px] mb-1" :class="isMe(msg) ? 'text-right text-pink-400' : 'text-slate-400'">
              {{ msg.profiles?.nickname || '...' }}
            </p>
            <div class="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
              :class="isMe(msg)
                ? 'bg-pink-500 text-white rounded-br-md'
                : 'bg-slate-800 text-slate-100 rounded-bl-md'">
              {{ msg.text }}
            </div>
            <p class="text-[10px] mt-1 text-slate-500" :class="isMe(msg) ? 'text-right' : ''">
              {{ new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="p-3 bg-slate-900/80 backdrop-blur border-t border-slate-800">
        <div class="flex gap-2">
          <textarea
            v-model="messageText"
            @keydown="handleKeydown"
            placeholder="메시지를 입력하세요..."
            rows="1"
            class="flex-1 bg-slate-800 text-white rounded-xl px-4 py-3 text-sm border border-slate-700 focus:border-pink-400 focus:outline-none resize-none"
          />
          <button
            @click="send"
            :disabled="!messageText.trim() || sending"
            class="bg-pink-500 hover:bg-pink-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl px-4 transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
