<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth'
import LoadingSpinner from '../components/common/LoadingSpinner.vue'

const props = defineProps({ dayId: String })
const router = useRouter()
const auth = useAuthStore()
const day = ref(null)
const messages = ref([])
const loading = ref(true)
const loadError = ref('')

const isMe = (msg) => msg.sender_user_id === auth.userId

onMounted(async () => {
  try {
    const [dayRes, msgRes] = await Promise.all([
      supabase.from('conversation_days').select('*').eq('id', props.dayId).single(),
      supabase.from('messages')
        .select('*')
        .eq('day_id', props.dayId)
        .order('created_at', { ascending: true })
    ])

    if (dayRes.error) {
      loadError.value = '대화를 찾을 수 없습니다: ' + dayRes.error.message
    } else {
      day.value = dayRes.data
    }

    if (msgRes.error) {
      loadError.value = '메시지를 불러올 수 없습니다: ' + msgRes.error.message
    } else {
      // Fetch sender profiles separately (FK join doesn't work for sender_user_id)
      const msgData = msgRes.data || []
      const senderIds = [...new Set(msgData.map(m => m.sender_user_id).filter(Boolean))]
      const profileMap = {}
      if (senderIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, nickname, avatar_url')
          .in('user_id', senderIds)
        if (profiles) {
          for (const p of profiles) profileMap[p.user_id] = p
        }
      }
      messages.value = msgData.map(m => ({
        ...m,
        profiles: profileMap[m.sender_user_id] || null
      }))
    }
  } catch (e) {
    loadError.value = '데이터 로딩 오류: ' + e.message
  }
  loading.value = false
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-2 px-4 pt-4 pb-2">
      <button @click="router.back()" class="text-pink-400 hover:text-pink-600">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
      <div>
        <h1 class="text-lg font-bold text-rose-800">{{ day?.title_override || day?.title || day?.date || '...' }}</h1>
        <p class="text-xs text-pink-400/70">{{ day?.date }}</p>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <LoadingSpinner v-if="loading" />

      <div v-if="loadError" class="text-center text-red-400 py-8 text-sm">
        {{ loadError }}
      </div>

      <div v-else-if="!loading && messages.length === 0" class="text-center text-pink-300 py-12">
        <div class="text-2xl mb-2">&#x2764;</div>
        이 날의 메시지가 없습니다
      </div>

      <div v-for="msg in messages" :key="msg.id"
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
  </div>
</template>
