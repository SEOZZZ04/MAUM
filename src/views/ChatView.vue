<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat'
import { useCoupleStore } from '../stores/couple'
import { useAuthStore } from '../stores/auth'
import { api } from '../lib/api'
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

// Guest lobby state
const guestLobbyLoading = ref(false)
const sendingRequest = ref(null)
const requestSent = ref({})

const isMe = (msg) => msg.sender_user_id === auth.userId

onMounted(async () => {
  if (!couple.isConnected) {
    // If guest, load lobby data
    if (auth.isGuest) {
      await loadGuestLobby()
    }
    return
  }
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

// Handle visibility change - reload messages when returning to tab
watch(() => document.visibilityState, async () => {
  if (document.visibilityState === 'visible' && couple.isConnected && chat.todayThread) {
    await chat.loadMessages(chat.todayThread.id)
    scrollToBottom()
  }
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

// Guest lobby functions
async function loadGuestLobby() {
  guestLobbyLoading.value = true
  await couple.fetchOnlineGuests()
  await couple.fetchPendingRequests()
  guestLobbyLoading.value = false
}

async function sendConnectionReq(userId) {
  sendingRequest.value = userId
  try {
    await couple.sendConnectionRequest(userId)
    requestSent.value[userId] = true
  } catch (e) {
    alert('연결 요청 실패: ' + e.message)
  }
  sendingRequest.value = null
}

async function acceptReq(requestId) {
  try {
    await couple.acceptConnectionRequest(requestId)
    // After accepting, init chat
    const day = await chat.ensureTodayThread()
    if (day) {
      await chat.loadMessages(day.id)
      chat.subscribeToMessages(day.id)
    }
  } catch (e) {
    alert('연결 수락 실패: ' + e.message)
  }
}

async function rejectReq(requestId) {
  await couple.rejectConnectionRequest(requestId)
}

async function refreshLobby() {
  await loadGuestLobby()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Not connected -->
    <div v-if="!couple.isConnected" class="flex-1 flex flex-col items-center px-6 text-center overflow-y-auto">
      <!-- Guest lobby -->
      <template v-if="auth.isGuest">
        <div class="pt-8 pb-4">
          <div class="text-5xl mb-3">🐿️</div>
          <h2 class="text-xl font-bold text-amber-900 mb-1">게스트 로비</h2>
          <p class="text-amber-600/70 text-sm">접속 중인 다른 게스트와 연결해보세요!</p>
        </div>

        <!-- Pending incoming requests -->
        <div v-if="couple.pendingRequests.length > 0" class="w-full max-w-sm mb-4">
          <h3 class="text-sm font-bold text-amber-800 mb-2 text-left">받은 연결 요청</h3>
          <div v-for="req in couple.pendingRequests" :key="req.id"
            class="bg-amber-100/80 border border-amber-300 rounded-2xl p-3 mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-amber-400/30 flex items-center justify-center text-amber-700 text-sm font-bold">
                {{ req.from_profile?.nickname?.[0] || '?' }}
              </div>
              <span class="text-amber-900 font-medium text-sm">{{ req.from_profile?.nickname || 'Guest' }}</span>
            </div>
            <div class="flex gap-1.5">
              <button @click="acceptReq(req.id)"
                class="bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">
                수락
              </button>
              <button @click="rejectReq(req.id)"
                class="bg-red-400 hover:bg-red-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">
                거절
              </button>
            </div>
          </div>
        </div>

        <!-- Online guests list -->
        <div class="w-full max-w-sm">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-bold text-amber-800">접속 중인 게스트</h3>
            <button @click="refreshLobby" class="text-xs text-amber-500 hover:text-amber-600 transition-colors">
              새로고침
            </button>
          </div>

          <LoadingSpinner v-if="guestLobbyLoading" />

          <div v-else-if="couple.onlineGuests.length === 0"
            class="bg-white/60 border border-amber-200 rounded-2xl p-6 text-center">
            <div class="text-3xl mb-2">🌰</div>
            <p class="text-amber-600/70 text-sm">아직 접속 중인 게스트가 없어요</p>
            <p class="text-amber-500/50 text-xs mt-1">잠시 후 새로고침 해보세요!</p>
          </div>

          <div v-for="guest in couple.onlineGuests" :key="guest.user_id"
            class="bg-white/80 border border-amber-200 rounded-2xl p-3 mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="relative">
                <div class="w-9 h-9 rounded-full bg-amber-400/30 flex items-center justify-center text-amber-700 text-sm font-bold">
                  {{ guest.nickname?.[0] || '?' }}
                </div>
                <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white pulse-online"></div>
              </div>
              <div class="text-left">
                <span class="text-amber-900 font-medium text-sm">{{ guest.nickname }}</span>
                <p class="text-amber-500/60 text-[10px]">접속중</p>
              </div>
            </div>
            <button
              @click="sendConnectionReq(guest.user_id)"
              :disabled="sendingRequest === guest.user_id || requestSent[guest.user_id]"
              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              :class="requestSent[guest.user_id]
                ? 'bg-amber-200 text-amber-500'
                : 'bg-amber-400 hover:bg-amber-500 text-white hover:-translate-y-0.5'"
            >
              {{ requestSent[guest.user_id] ? '요청됨' : '연결하기' }}
            </button>
          </div>
        </div>

        <div class="mt-6 mb-4">
          <router-link to="/settings"
            class="text-amber-500 hover:text-amber-600 text-sm font-medium transition-colors">
            초대코드로 연결하기 →
          </router-link>
        </div>
      </template>

      <!-- Regular user not connected -->
      <template v-else>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="text-6xl mb-4">🐿️</div>
          <h2 class="text-xl font-bold text-amber-900 mb-2">커플 연동이 필요해요</h2>
          <p class="text-amber-600/70 mb-6">설정에서 초대코드를 생성하거나 입력해주세요</p>
          <router-link to="/settings"
            class="bg-amber-400 hover:bg-amber-500 text-white px-6 py-3 rounded-2xl font-semibold transition-all hover:-translate-y-0.5 shadow-md shadow-amber-200">
            설정으로 이동
          </router-link>
        </div>
      </template>
    </div>

    <!-- Chat -->
    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 class="text-lg font-bold text-amber-900">{{ couple.partner?.nickname || '상대방' }}과의 대화</h1>
          <p class="text-xs text-amber-500/70">{{ chat.todayThread?.date || '오늘' }}</p>
        </div>
        <div class="flex gap-2">
          <button @click="showAnalysis = !showAnalysis"
            class="text-xs bg-violet-100 text-violet-600 px-3 py-1.5 rounded-lg hover:bg-violet-200 transition-colors font-medium">
            분석
          </button>
          <button @click="router.push('/archive')"
            class="text-xs bg-amber-100 text-amber-600 px-3 py-1.5 rounded-lg hover:bg-amber-200 transition-colors font-medium">
            아카이브
          </button>
          <button @click="archiveAndReset"
            class="text-xs bg-red-100 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-200 transition-colors font-medium">
            초기화
          </button>
        </div>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-violet-50 border border-violet-200 rounded-2xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 최근 갈등 패턴이 뭐야?"
            class="flex-1 bg-white text-amber-900 text-sm rounded-lg px-3 py-2 border border-violet-200 focus:border-violet-400 focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-violet-500 hover:bg-violet-600 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-violet-500 text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-amber-800 whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <LoadingSpinner v-if="chat.loading" />
        <div v-for="msg in chat.messages" :key="msg.id"
          class="flex" :class="isMe(msg) ? 'justify-end' : 'justify-start'">
          <div class="max-w-[75%]">
            <p class="text-[10px] mb-1" :class="isMe(msg) ? 'text-right text-amber-500' : 'text-amber-400'">
              {{ msg.profiles?.nickname || '...' }}
            </p>
            <div class="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
              :class="isMe(msg)
                ? 'bg-amber-400 text-white rounded-br-md shadow-sm shadow-amber-200'
                : 'bg-white text-amber-900 rounded-bl-md border border-amber-100 shadow-sm'">
              {{ msg.text }}
            </div>
            <p class="text-[10px] mt-1 text-amber-400/60" :class="isMe(msg) ? 'text-right' : ''">
              {{ new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="p-3 bg-white/80 backdrop-blur border-t border-amber-200">
        <div class="flex gap-2">
          <textarea
            v-model="messageText"
            @keydown="handleKeydown"
            placeholder="메시지를 입력하세요..."
            rows="1"
            class="flex-1 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-sm border border-amber-200 focus:border-amber-400 focus:outline-none resize-none placeholder-amber-300"
          />
          <button
            @click="send"
            :disabled="!messageText.trim() || sending"
            class="bg-amber-400 hover:bg-amber-500 disabled:bg-amber-200 disabled:text-amber-300 text-white rounded-xl px-4 transition-colors"
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
