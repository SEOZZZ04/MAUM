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

// Initialize chat when couple is connected
async function doInitChat() {
  const day = await chat.initChat()
  if (day) {
    await nextTick()
    scrollToBottom()
  }
}

onMounted(async () => {
  // If already connected, init immediately
  if (couple.isConnected) {
    await doInitChat()
    return
  }
  // If not connected yet, load guest lobby for guests
  if (auth.isGuest) {
    await loadGuestLobby()
  }
})

onUnmounted(() => {
  chat.unsubscribe()
  // Remove visibility handler
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
  }
})

// Watch for couple connection change - use immediate to catch already-connected state
// This handles the case where couple data loads AFTER ChatView mounts
watch(() => couple.isConnected, async (connected, wasConnected) => {
  if (connected && !wasConnected) {
    // Just got connected (or was already connected when watch first runs)
    await doInitChat()
  } else if (!connected && wasConnected) {
    // Just got disconnected - clean up chat
    chat.unsubscribe()
    chat.messages.splice(0)
  }
})

// Handle visibility change with debounce to prevent multiple rapid reconnections
let _reconnectTimer = null
const visibilityHandler = () => {
  if (document.visibilityState === 'visible' && couple.isConnected) {
    // Debounce: wait 300ms to avoid firing multiple times
    if (_reconnectTimer) clearTimeout(_reconnectTimer)
    _reconnectTimer = setTimeout(async () => {
      _reconnectTimer = null
      try {
        await chat.reconnect()
        await nextTick()
        scrollToBottom()
      } catch (e) {
        console.error('Reconnect error:', e)
        // Last resort: try a simple message reload
        try {
          if (chat.todayThread) {
            await chat.loadMessages(chat.todayThread.id)
            scrollToBottom()
          }
        } catch {
          // Silently fail - user can refresh manually
        }
      }
    }, 300)
  }
}
document.addEventListener('visibilitychange', visibilityHandler)

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
  await doInitChat()
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
    // Chat init will be triggered by the isConnected watcher
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
          <div class="flex items-center justify-center gap-1 mb-3">
            <span class="text-3xl text-pink-400 float-heart">&#x2764;</span>
            <span class="text-2xl text-sky-400 float-heart-delay">&#x2764;</span>
          </div>
          <h2 class="text-xl font-bold text-rose-800 mb-1">게스트 로비</h2>
          <p class="text-pink-400/70 text-sm">접속 중인 다른 게스트와 연결해보세요!</p>
        </div>

        <!-- Pending incoming requests -->
        <div v-if="couple.pendingRequests.length > 0" class="w-full max-w-sm mb-4">
          <h3 class="text-sm font-bold text-rose-800 mb-2 text-left">받은 연결 요청</h3>
          <div v-for="req in couple.pendingRequests" :key="req.id"
            class="bg-pink-50/80 border border-pink-200 rounded-2xl p-3 mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-pink-200/50 flex items-center justify-center text-pink-600 text-sm font-bold">
                {{ req.from_profile?.nickname?.[0] || '?' }}
              </div>
              <span class="text-rose-800 font-medium text-sm">{{ req.from_profile?.nickname || 'Guest' }}</span>
            </div>
            <div class="flex gap-1.5">
              <button @click="acceptReq(req.id)"
                class="bg-pink-400 hover:bg-pink-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">
                수락
              </button>
              <button @click="rejectReq(req.id)"
                class="bg-gray-300 hover:bg-gray-400 text-gray-600 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">
                거절
              </button>
            </div>
          </div>
        </div>

        <!-- Online guests list -->
        <div class="w-full max-w-sm">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-bold text-rose-800">접속 중인 게스트</h3>
            <button @click="refreshLobby" class="text-xs text-pink-400 hover:text-pink-500 transition-colors">
              새로고침
            </button>
          </div>

          <LoadingSpinner v-if="guestLobbyLoading" />

          <div v-else-if="couple.onlineGuests.length === 0"
            class="bg-white/60 border border-pink-100 rounded-2xl p-6 text-center">
            <div class="text-2xl mb-2 text-pink-300">&#x2764;</div>
            <p class="text-pink-400/70 text-sm">아직 접속 중인 게스트가 없어요</p>
            <p class="text-pink-300/50 text-xs mt-1">잠시 후 새로고침 해보세요!</p>
          </div>

          <div v-for="guest in couple.onlineGuests" :key="guest.user_id"
            class="bg-white/80 border border-pink-100 rounded-2xl p-3 mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="relative">
                <div class="w-9 h-9 rounded-full bg-gradient-to-br from-pink-200 to-sky-200 flex items-center justify-center text-pink-600 text-sm font-bold">
                  {{ guest.nickname?.[0] || '?' }}
                </div>
                <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white pulse-online"></div>
              </div>
              <div class="text-left">
                <span class="text-rose-800 font-medium text-sm">{{ guest.nickname }}</span>
                <p class="text-pink-400/60 text-[10px]">접속중</p>
              </div>
            </div>
            <button
              @click="sendConnectionReq(guest.user_id)"
              :disabled="sendingRequest === guest.user_id || requestSent[guest.user_id]"
              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              :class="requestSent[guest.user_id]
                ? 'bg-pink-100 text-pink-400'
                : 'bg-pink-400 hover:bg-pink-500 text-white hover:-translate-y-0.5'"
            >
              {{ requestSent[guest.user_id] ? '요청됨' : '연결하기' }}
            </button>
          </div>
        </div>

        <div class="mt-6 mb-4">
          <router-link to="/settings"
            class="text-pink-400 hover:text-pink-500 text-sm font-medium transition-colors">
            초대코드로 연결하기 →
          </router-link>
        </div>
      </template>

      <!-- Regular user not connected -->
      <template v-else>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="flex items-center gap-2 mb-4">
            <span class="text-4xl text-pink-400 float-heart">&#x2764;</span>
            <span class="text-3xl text-sky-400 float-heart-delay">&#x2764;</span>
          </div>
          <h2 class="text-xl font-bold text-rose-800 mb-2">커플 연동이 필요해요</h2>
          <p class="text-pink-400/70 mb-6">설정에서 초대코드를 생성하거나 입력해주세요</p>
          <router-link to="/settings"
            class="bg-gradient-to-r from-pink-400 to-rose-400 hover:from-pink-500 hover:to-rose-500 text-white px-6 py-3 rounded-2xl font-semibold transition-all hover:-translate-y-0.5 shadow-md shadow-pink-200">
            설정으로 이동
          </router-link>
        </div>
      </template>
    </div>

    <!-- Chat -->
    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div class="flex items-center gap-2">
          <span class="text-pink-400 text-lg">&#x2764;</span>
          <div>
            <h1 class="text-lg font-bold text-rose-800">{{ couple.partner?.nickname || '상대방' }}과의 대화</h1>
            <p class="text-xs text-pink-400/70">
              {{ chat.todayThread?.date || '오늘' }}
              <span v-if="chat.extractingGraph" class="text-purple-400 ml-1 animate-pulse">&#x2728; 그래프 추출중...</span>
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="chat.triggerGraphExtraction()"
            :disabled="chat.extractingGraph || chat.messages.length < 3"
            class="text-xs bg-emerald-100 text-emerald-500 px-3 py-1.5 rounded-lg hover:bg-emerald-200 transition-colors font-medium disabled:opacity-40"
            title="대화에서 그래프 추출">
            그래프
          </button>
          <button @click="showAnalysis = !showAnalysis"
            class="text-xs bg-purple-100 text-purple-500 px-3 py-1.5 rounded-lg hover:bg-purple-200 transition-colors font-medium">
            분석
          </button>
          <button @click="router.push('/archive')"
            class="text-xs bg-sky-100 text-sky-500 px-3 py-1.5 rounded-lg hover:bg-sky-200 transition-colors font-medium">
            아카이브
          </button>
          <button @click="archiveAndReset"
            class="text-xs bg-red-50 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors font-medium">
            초기화
          </button>
        </div>
      </div>

      <!-- Analysis Panel -->
      <div v-if="showAnalysis" class="mx-4 mb-2 bg-purple-50/80 border border-purple-200 rounded-2xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis"
            placeholder="예: 최근 갈등 패턴이 뭐야?"
            class="flex-1 bg-white text-rose-800 text-sm rounded-lg px-3 py-2 border border-purple-200 focus:border-purple-400 focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-purple-400 hover:bg-purple-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium">
            질문
          </button>
        </div>
        <div v-if="analysisLoading" class="text-purple-400 text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-rose-800 whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <!-- Init Error -->
      <div v-if="chat.initError" class="mx-4 mb-2 bg-red-50/80 border border-red-200 rounded-2xl p-4 text-center">
        <p class="text-red-500 text-sm mb-2">{{ chat.initError }}</p>
        <button @click="doInitChat"
          class="bg-red-400 hover:bg-red-500 text-white text-xs px-4 py-2 rounded-lg transition-colors font-medium">
          다시 시도
        </button>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <LoadingSpinner v-if="chat.loading" />
        <div v-for="msg in chat.messages" :key="msg.id"
          class="flex" :class="isMe(msg) ? 'justify-end' : 'justify-start'">
          <div class="max-w-[75%]">
            <p class="text-[10px] mb-1" :class="isMe(msg) ? 'text-right text-pink-400' : 'text-sky-400'">
              {{ msg.profiles?.nickname || '...' }}
            </p>
            <div class="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
              :class="isMe(msg)
                ? 'bg-gradient-to-br from-pink-400 to-rose-400 text-white rounded-br-md shadow-sm shadow-pink-200'
                : 'bg-white text-rose-800 rounded-bl-md border border-sky-100 shadow-sm shadow-sky-100/50'">
              {{ msg.text }}
            </div>
            <p class="text-[10px] mt-1 text-pink-300/60" :class="isMe(msg) ? 'text-right' : ''">
              {{ new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="p-3 bg-white/80 backdrop-blur border-t border-pink-100">
        <div class="flex gap-2">
          <textarea
            v-model="messageText"
            @keydown="handleKeydown"
            placeholder="메시지를 입력하세요..."
            rows="1"
            class="flex-1 bg-pink-50/50 text-rose-800 rounded-xl px-4 py-3 text-sm border border-pink-200 focus:border-pink-400 focus:outline-none resize-none placeholder-pink-300"
          />
          <button
            @click="send"
            :disabled="!messageText.trim() || sending"
            class="btn-send text-white rounded-xl px-4"
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
