<script setup>
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useCoupleStore } from './stores/couple'
import BottomTabs from './components/common/BottomTabs.vue'

const auth = useAuthStore()
const couple = useCoupleStore()
const route = useRoute()
const router = useRouter()

onMounted(async () => {
  await auth.init()
  if (auth.isLoggedIn) {
    await couple.fetchCouple()
    // Set guest online status
    if (auth.isGuest) {
      await auth.setGuestOnline()
      couple.subscribeToGuestUpdates()
    }
  }
})

onUnmounted(() => {
  if (auth.isGuest) {
    auth.setGuestOffline()
    couple.unsubscribeFromGuestUpdates()
  }
})

// Handle beforeunload to set offline
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (auth.isGuest && auth.userId) {
      // Use sendBeacon for reliable offline status
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?user_id=eq.${auth.userId}`
      navigator.sendBeacon(url) // Best-effort
    }
  })
}
</script>

<template>
  <div class="h-full flex flex-col bg-gradient-to-b from-amber-50 to-orange-50 text-amber-950">
    <!-- Loading -->
    <div v-if="auth.loading" class="flex-1 flex flex-col items-center justify-center">
      <div class="text-5xl mb-3">🐿️</div>
      <div class="animate-pulse text-amber-500 text-xl font-bold">MAUM</div>
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
