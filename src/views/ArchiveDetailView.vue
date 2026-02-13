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

const isMe = (msg) => msg.sender_user_id === auth.userId

onMounted(async () => {
  const [dayRes, msgRes] = await Promise.all([
    supabase.from('conversation_days').select('*').eq('id', props.dayId).single(),
    supabase.from('messages')
      .select('*, profiles:sender_user_id(nickname, avatar_url)')
      .eq('day_id', props.dayId)
      .order('created_at', { ascending: true })
  ])
  day.value = dayRes.data
  messages.value = msgRes.data || []
  loading.value = false
})
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-2 px-4 pt-4 pb-2">
      <button @click="router.back()" class="text-slate-400 hover:text-white">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
      <div>
        <h1 class="text-lg font-bold">{{ day?.title_override || day?.title || day?.date || '...' }}</h1>
        <p class="text-xs text-slate-400">{{ day?.date }}</p>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <LoadingSpinner v-if="loading" />
      <div v-for="msg in messages" :key="msg.id"
        class="flex" :class="isMe(msg) ? 'justify-end' : 'justify-start'">
        <div class="max-w-[75%]">
          <p class="text-[10px] mb-1" :class="isMe(msg) ? 'text-right text-pink-400' : 'text-slate-400'">
            {{ msg.profiles?.nickname || '...' }}
          </p>
          <div class="px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
            :class="isMe(msg) ? 'bg-pink-500 text-white rounded-br-md' : 'bg-slate-800 text-slate-100 rounded-bl-md'">
            {{ msg.text }}
          </div>
          <p class="text-[10px] mt-1 text-slate-500" :class="isMe(msg) ? 'text-right' : ''">
            {{ new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
