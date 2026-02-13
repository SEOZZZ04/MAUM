<script setup>
import { onMounted } from 'vue'
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
  }
})
</script>

<template>
  <div class="h-full flex flex-col bg-slate-950 text-white">
    <!-- Loading -->
    <div v-if="auth.loading" class="flex-1 flex items-center justify-center">
      <div class="animate-pulse text-pink-400 text-xl font-bold">MAUM</div>
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
