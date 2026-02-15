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

const guestLobbyLoading = ref(false)
const sendingRequest = ref(null)
const requestSent = ref({})

const isMe = (msg) => msg.sender_user_id === auth.userId

async function doInitChat() {
  const day = await chat.initChat()
  if (day) {
    await nextTick()
    scrollToBottom()
  }
}

onMounted(async () => {
  if (couple.isConnected) {
    await doInitChat()
    return
  }
  if (auth.isGuest) {
    await loadGuestLobby()
  }
})

onUnmounted(() => {
  chat.unsubscribe()
})

watch(() => couple.isConnected, async (connected, wasConnected) => {
  if (connected && !wasConnected) {
    await doInitChat()
  } else if (!connected && wasConnected) {
    chat.unsubscribe()
    chat.messages.splice(0)
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
      <template v-if="auth.isGuest">
        <div class="pt-8 pb-4">
          <div class="flex items-center justify-center gap-1 mb-3">
            <span class="text-3xl text-amber-400 float-heart">&#x2764;</span>
            <span class="text-2xl text-orange-300 float-heart-delay">&#x2764;</span>
          </div>
          <h2 class="text-xl font-bold text-[#5d4e37] font-display mb-1">게스트 로비</h2>
          <p class="text-[#b5a48e] text-sm">접속 중인 다른 게스트와 연결해보세요!</p>
        </div>

        <div v-if="couple.pendingRequests.length > 0" class="w-full max-w-sm mb-4">
          <h3 class="text-sm font-bold text-[#5d4e37] mb-2 text-left">받은 연결 요청</h3>
          <div v-for="req in couple.pendingRequests" :key="req.id"
            class="bg-[#f5ead6]/80 border border-[#ecdcc5] rounded-2xl p-3 mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-[#ecdcc5]/50 flex items-center justify-center text-[#8a7560] text-sm font-bold">{{ req.from_profile?.nickname?.[0] || '?' }}</div>
              <span class="text-[#5d4e37] font-medium text-sm">{{ req.from_profile?.nickname || 'Guest' }}</span>
            </div>
            <div class="flex gap-1.5">
              <button @click="acceptReq(req.id)" class="bg-[#c9a96e] hover:bg-[#b08d4f] text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">수락</button>
              <button @click="rejectReq(req.id)" class="bg-gray-300 hover:bg-gray-400 text-gray-600 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors">거절</button>
            </div>
          </div>
        </div>

        <div class="w-full max-w-sm">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-bold text-[#5d4e37]">접속 중인 게스트</h3>
            <button @click="refreshLobby" class="text-xs text-[#c9a96e] hover:text-[#b08d4f] transition-colors">새로고침</button>
          </div>
          <LoadingSpinner v-if="guestLobbyLoading" />
          <div v-else-if="couple.onlineGuests.length === 0" class="bg-[#fffcf7]/60 border border-[#ecdcc5] rounded-2xl p-6 text-center">
            <div class="text-2xl mb-2 text-[#d4bfa0]">&#x2764;</div>
            <p class="text-[#b5a48e] text-sm">아직 접속 중인 게스트가 없어요</p>
            <p class="text-[#d4bfa0] text-xs mt-1">잠시 후 새로고침 해보세요!</p>
          </div>
          <div v-for="guest in couple.onlineGuests" :key="guest.user_id"
            class="bg-[#fffcf7]/80 border border-[#ecdcc5] rounded-2xl p-3 mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="relative">
                <div class="w-9 h-9 rounded-full bg-gradient-to-br from-[#f5ead6] to-[#ecdcc5] flex items-center justify-center text-[#8a7560] text-sm font-bold">{{ guest.nickname?.[0] || '?' }}</div>
                <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white pulse-online"></div>
              </div>
              <div class="text-left">
                <span class="text-[#5d4e37] font-medium text-sm">{{ guest.nickname }}</span>
                <p class="text-[#b5a48e] text-[10px]">접속중</p>
              </div>
            </div>
            <button @click="sendConnectionReq(guest.user_id)" :disabled="sendingRequest === guest.user_id || requestSent[guest.user_id]"
              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              :class="requestSent[guest.user_id] ? 'bg-[#f5ead6] text-[#c9a96e]' : 'bg-[#c9a96e] hover:bg-[#b08d4f] text-white hover:-translate-y-0.5'">
              {{ requestSent[guest.user_id] ? '요청됨' : '연결하기' }}
            </button>
          </div>
        </div>
        <div class="mt-6 mb-4">
          <router-link to="/settings" class="text-[#c9a96e] hover:text-[#b08d4f] text-sm font-medium transition-colors">초대코드로 연결하기 →</router-link>
        </div>
      </template>

      <template v-else>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div class="flex items-center gap-2 mb-4">
            <span class="text-4xl text-amber-400 float-heart">&#x2764;</span>
            <span class="text-3xl text-orange-300 float-heart-delay">&#x2764;</span>
          </div>
          <h2 class="text-xl font-bold text-[#5d4e37] font-display mb-2">커플 연동이 필요해요</h2>
          <p class="text-[#b5a48e] mb-6">설정에서 초대코드를 생성하거나 입력해주세요</p>
          <router-link to="/settings"
            class="bg-gradient-to-r from-[#c9a96e] to-[#d4a574] hover:from-[#b08d4f] hover:to-[#c08a56] text-white px-6 py-3 rounded-2xl font-semibold transition-all hover:-translate-y-0.5 shadow-md shadow-[#c9a96e]/20">
            설정으로 이동
          </router-link>
        </div>
      </template>
    </div>

    <!-- Chat -->
    <template v-else>
      <div class="flex items-center justify-between px-4 pt-4 pb-2">
        <div class="flex items-center gap-2">
          <span class="text-amber-400 text-lg">&#x2764;</span>
          <div>
            <h1 class="text-lg font-bold text-[#5d4e37] font-display">{{ couple.partner?.nickname || '상대방' }}과의 대화</h1>
            <p class="text-xs text-[#b5a48e]">
              {{ chat.todayThread?.date || '오늘' }}
              <span v-if="chat.extractingGraph" class="text-[#c9b8d9] ml-1 animate-pulse">&#x2728; 그래프 추출중...</span>
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <button @click="chat.triggerGraphExtraction()" :disabled="chat.extractingGraph || chat.messages.length < 3"
            class="text-xs bg-[#b5d8c7]/30 text-[#6b9a7e] px-3 py-1.5 rounded-lg hover:bg-[#b5d8c7]/50 transition-colors font-medium disabled:opacity-40">그래프</button>
          <button @click="showAnalysis = !showAnalysis"
            class="text-xs bg-[#c9b8d9]/30 text-[#8a6fa0] px-3 py-1.5 rounded-lg hover:bg-[#c9b8d9]/40 transition-colors font-medium">분석</button>
          <button @click="router.push('/archive')"
            class="text-xs bg-[#d4bfa0]/30 text-[#8a7560] px-3 py-1.5 rounded-lg hover:bg-[#d4bfa0]/40 transition-colors font-medium">아카이브</button>
          <button @click="archiveAndReset"
            class="text-xs bg-red-50 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors font-medium">초기화</button>
        </div>
      </div>

      <div v-if="showAnalysis" class="mx-4 mb-2 bg-[#c9b8d9]/15 border border-[#c9b8d9]/30 rounded-2xl p-4">
        <div class="flex gap-2 mb-3">
          <input v-model="analysisQuestion" @keydown.enter="askAnalysis" placeholder="예: 최근 갈등 패턴이 뭐야?"
            class="flex-1 bg-white text-[#5d4e37] text-sm rounded-lg px-3 py-2 border border-[#c9b8d9]/30 focus:border-[#c9b8d9] focus:outline-none" />
          <button @click="askAnalysis" :disabled="analysisLoading"
            class="bg-[#c9b8d9]/60 hover:bg-[#c9b8d9]/80 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium">질문</button>
        </div>
        <div v-if="analysisLoading" class="text-[#8a6fa0] text-sm animate-pulse">분석 중...</div>
        <div v-else-if="analysisResult" class="text-sm text-[#5d4e37] whitespace-pre-wrap">{{ analysisResult.answer }}</div>
      </div>

      <div v-if="chat.initError" class="mx-4 mb-2 bg-red-50/80 border border-red-200 rounded-2xl p-4 text-center">
        <p class="text-red-500 text-sm mb-2">{{ chat.initError }}</p>
        <button @click="doInitChat" class="bg-red-400 hover:bg-red-500 text-white text-xs px-4 py-2 rounded-lg transition-colors font-medium">다시 시도</button>
      </div>

      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <LoadingSpinner v-if="chat.loading" />
        <div v-for="msg in chat.messages" :key="msg.id" class="flex" :class="isMe(msg) ? 'justify-end' : 'justify-start'">
          <div class="max-w-[75%]">
            <p class="text-[10px] mb-1" :class="isMe(msg) ? 'text-right text-[#c9a96e]' : 'text-[#d4a574]'">{{ msg.profiles?.nickname || '...' }}</p>
            <div class="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
              :class="isMe(msg) ? 'bg-gradient-to-br from-[#c9a96e] to-[#b08d4f] text-white rounded-br-md shadow-sm shadow-[#c9a96e]/20' : 'bg-[#fffcf7] text-[#5d4e37] rounded-bl-md border border-[#ecdcc5] shadow-sm shadow-[#ecdcc5]/50'">
              {{ msg.text }}
            </div>
            <p class="text-[10px] mt-1 text-[#d4bfa0]" :class="isMe(msg) ? 'text-right' : ''">
              {{ new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }}
            </p>
          </div>
        </div>
      </div>

      <div class="p-3 bg-[#fffcf7]/80 backdrop-blur border-t border-[#ecdcc5]">
        <div class="flex gap-2">
          <textarea v-model="messageText" @keydown="handleKeydown" placeholder="메시지를 입력하세요..." rows="1"
            class="flex-1 bg-[#f5ead6]/40 text-[#5d4e37] rounded-xl px-4 py-3 text-sm border border-[#ecdcc5] focus:border-[#c9a96e] focus:outline-none resize-none placeholder-[#d4bfa0]" />
          <button @click="send" :disabled="!messageText.trim() || sending" class="btn-send text-white rounded-xl px-4">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
