<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useCoupleStore } from './stores/couple'
import BottomTabs from './components/common/BottomTabs.vue'

const auth = useAuthStore()
const couple = useCoupleStore()
const route = useRoute()

onMounted(async () => {
  await auth.init()
  if (auth.isLoggedIn) {
    await couple.fetchCouple()
    // Subscribe to real-time updates for all logged-in users
    // (handles: online guests, connection requests, couple linking, invite code redemption)
    couple.subscribeToGuestUpdates()
    // Set guest online status
    if (auth.isGuest) {
      await auth.setGuestOnline()
      // Broadcast presence to lobby so other guests see us immediately
      couple.broadcastPresence(true)
    }
  }
})

onUnmounted(() => {
  if (auth.isGuest) {
    auth.setGuestOffline()
  }
  couple.cleanup()
})

// Handle beforeunload to set offline
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (auth.isGuest && auth.userId) {
      // Use sendBeacon to set offline status reliably on page close
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const url = `${supabaseUrl}/rest/v1/profiles?user_id=eq.${auth.userId}`
      const body = JSON.stringify({ is_online: false })
      const headers = {
        type: 'application/json'
      }
      // sendBeacon with proper PATCH request via fetch keepalive
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
  <div class="h-full flex flex-col bg-gradient-to-b from-pink-50 via-rose-50/30 to-sky-50/20 text-rose-950">
    <!-- Loading -->
    <div v-if="auth.loading" class="flex-1 flex flex-col items-center justify-center">
      <div class="flex gap-2 mb-4">
        <span class="text-3xl float-heart text-pink-400">&#x2764;</span>
        <span class="text-2xl float-heart-delay text-sky-400">&#x2764;</span>
        <span class="text-3xl float-heart-delay-2 text-pink-300">&#x2764;</span>
      </div>
      <div class="animate-pulse text-gradient-pink text-xl font-bold">MAUM</div>
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
