<script setup>
import { useAuthStore } from '../stores/auth'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()
const error = ref('')
const guestLoading = ref(false)

async function loginGoogle() {
  try {
    error.value = ''
    await auth.signInWithGoogle()
  } catch (e) {
    error.value = e.message
  }
}

async function loginGuest() {
  try {
    error.value = ''
    guestLoading.value = true
    await auth.signInAsGuest()
    router.push('/chat')
  } catch (e) {
    error.value = e.message
  } finally {
    guestLoading.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center px-6 bg-gradient-to-b from-pink-50/60 via-white to-sky-50/40 heart-bg relative overflow-hidden">
    <!-- Decorative floating hearts -->
    <div class="absolute top-12 left-8 text-pink-300/40 text-2xl float-heart select-none pointer-events-none">&#x2764;</div>
    <div class="absolute top-20 right-12 text-sky-300/40 text-xl float-heart-delay select-none pointer-events-none">&#x2764;</div>
    <div class="absolute bottom-32 left-16 text-pink-200/30 text-lg float-heart-delay-2 select-none pointer-events-none">&#x2764;</div>
    <div class="absolute bottom-40 right-8 text-sky-200/30 text-2xl float-heart select-none pointer-events-none">&#x2764;</div>

    <!-- Logo & Hearts -->
    <div class="text-center mb-8 relative z-10">
      <div class="flex items-center justify-center gap-2 mb-4">
        <span class="text-4xl text-pink-400 float-heart">&#x2764;</span>
        <span class="text-3xl text-sky-400 float-heart-delay">&#x2764;</span>
        <span class="text-4xl text-pink-300 float-heart-delay-2">&#x2764;</span>
      </div>
      <h1 class="text-5xl font-black text-gradient-pink mb-2">
        MAUM
      </h1>
      <p class="text-rose-500/70 text-lg font-medium">커플 관계 분석 & 지식 그래프</p>
      <p class="text-pink-400/80 text-sm mt-1">마음을 나누는 따뜻한 공간</p>
    </div>

    <div class="w-full max-w-sm space-y-3 relative z-10">
      <!-- Google Login -->
      <button
        @click="loginGoogle"
        class="w-full flex items-center justify-center gap-3 bg-white text-gray-700 font-semibold py-3.5 px-6 rounded-2xl shadow-md shadow-pink-200/50 hover:shadow-lg hover:shadow-pink-200/60 hover:-translate-y-0.5 transition-all border border-pink-100"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Google로 로그인
      </button>

      <!-- Divider -->
      <div class="flex items-center gap-3 py-1">
        <div class="flex-1 h-px bg-pink-200"></div>
        <span class="text-pink-300 text-xs font-medium">또는</span>
        <div class="flex-1 h-px bg-pink-200"></div>
      </div>

      <!-- Guest Login -->
      <button
        @click="loginGuest"
        :disabled="guestLoading"
        class="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-pink-400 to-rose-400 text-white font-semibold py-3.5 px-6 rounded-2xl shadow-md shadow-pink-200/50 hover:shadow-lg hover:shadow-pink-300/60 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:hover:translate-y-0"
      >
        <span class="text-lg">&#x2764;</span>
        {{ guestLoading ? '접속 중...' : '게스트로 체험하기' }}
      </button>

      <p class="text-center text-pink-400/60 text-xs mt-2">
        게스트 계정은 이 기기에서 자동 생성되며,<br/>
        다른 접속 중인 게스트와 연결하여 체험할 수 있어요!
      </p>
    </div>

    <p v-if="error" class="mt-4 text-red-400 text-sm text-center bg-red-50 px-4 py-2 rounded-xl relative z-10">{{ error }}</p>
  </div>
</template>
