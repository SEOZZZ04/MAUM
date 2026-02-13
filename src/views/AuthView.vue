<script setup>
import { useAuthStore } from '../stores/auth'
import { ref } from 'vue'

const auth = useAuthStore()
const error = ref('')

async function loginGoogle() {
  try {
    error.value = ''
    await auth.signInWithGoogle()
  } catch (e) {
    error.value = e.message
  }
}

async function loginKakao() {
  try {
    error.value = ''
    await auth.signInWithKakao()
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center px-6 bg-gradient-to-b from-slate-950 to-slate-900">
    <div class="text-center mb-12">
      <h1 class="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-rose-400 mb-3">
        MAUM
      </h1>
      <p class="text-slate-400 text-lg">커플 관계 분석 & 지식 그래프</p>
    </div>

    <div class="w-full max-w-sm space-y-4">
      <button
        @click="loginGoogle"
        class="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-semibold py-3 px-6 rounded-xl hover:bg-gray-100 transition-colors"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Google로 로그인
      </button>

      <button
        @click="loginKakao"
        class="w-full flex items-center justify-center gap-3 bg-[#FEE500] text-[#191919] font-semibold py-3 px-6 rounded-xl hover:bg-[#F5DC00] transition-colors"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#191919" d="M12 3C6.48 3 2 6.48 2 10.5c0 2.53 1.66 4.74 4.14 6.04l-1.06 3.88c-.09.34.28.6.56.4L9.8 18.1c.72.13 1.45.2 2.2.2 5.52 0 10-3.48 10-7.8S17.52 3 12 3z"/>
        </svg>
        카카오로 로그인
      </button>
    </div>

    <p v-if="error" class="mt-4 text-red-400 text-sm text-center">{{ error }}</p>
  </div>
</template>
