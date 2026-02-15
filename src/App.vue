<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useCoupleStore } from './stores/couple'
import { useChatStore } from './stores/chat'
import { useGraphStore } from './stores/graph'
import { installReconnectHandler, onTabResume, offTabResume } from './lib/reconnect'
import BottomTabs from './components/common/BottomTabs.vue'

const auth = useAuthStore()
const couple = useCoupleStore()
const chat = useChatStore()
const graph = useGraphStore()
const route = useRoute()

// Global tab-resume handler: refresh session + reconnect all realtime channels
async function handleTabResume(session) {
  if (!auth.isLoggedIn) return

  if (session?.user) {
    auth.user = session.user
  }

  // Reconnect couple realtime channels
  if (couple.isConnected) {
    couple.subscribeToCoupleChannel(couple.coupleId)
  }
  couple.subscribeToGuestUpdates()

  // Reconnect chat if there's an active thread
  try {
    await chat.reconnect()
  } catch {
    // chat reconnect is best-effort
  }

  // Reconnect graph realtime
  if (couple.isConnected) {
    graph.subscribeToGraphChanges()
  }

  // Refresh guest online status
  if (auth.isGuest) {
    await auth.setGuestOnline()
    couple.broadcastPresence(true)
  }
}

onMounted(async () => {
  // Install global reconnection manager (runs once)
  installReconnectHandler()
  onTabResume(handleTabResume)

  await auth.init()
  if (auth.isLoggedIn) {
    await couple.fetchCouple()
    couple.subscribeToGuestUpdates()
    if (auth.isGuest) {
      await auth.setGuestOnline()
      couple.broadcastPresence(true)
    }
  }
})

onUnmounted(() => {
  offTabResume(handleTabResume)
  if (auth.isGuest) {
    auth.setGuestOffline()
  }
  couple.cleanup()
})

// Handle beforeunload to set offline
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (auth.isGuest && auth.userId) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const url = `${supabaseUrl}/rest/v1/profiles?user_id=eq.${auth.userId}`
      const body = JSON.stringify({ is_online: false })
      fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body,
        keepalive: true
      }).catch(() => {})
    }
  })
}
</script>

<template>
  <div class="h-full flex flex-col bg-gradient-to-b from-amber-50/60 via-[#faf6f1] to-orange-50/30 text-[#5d4e37]">
    <!-- Loading -->
    <div v-if="auth.loading" class="flex-1 flex flex-col items-center justify-center">
      <div class="flex gap-2 mb-4">
        <span class="text-3xl float-heart text-amber-400">&#x2764;</span>
        <span class="text-2xl float-heart-delay text-orange-300">&#x2764;</span>
        <span class="text-3xl float-heart-delay-2 text-amber-300">&#x2764;</span>
      </div>
      <div class="animate-pulse text-gradient-warm text-xl font-bold font-display">MAUM</div>
    </div>

    <!-- Main content -->
    <template v-else>
      <div class="flex-1 overflow-hidden">
        <router-view />
      </div>
      <BottomTabs v-if="auth.isLoggedIn && !route.meta.public && route.name !== 'Admin'" />
    </template>
  </div>
</template>
