<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useCoupleStore } from '../stores/couple'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import PageHeader from '../components/common/PageHeader.vue'
import CardWrapper from '../components/common/CardWrapper.vue'

const auth = useAuthStore()
const couple = useCoupleStore()

const nickname = ref(auth.profile?.nickname || '')
const generatedCode = ref('')
const redeemCode = ref('')
const redeemError = ref('')
const redeemSuccess = ref(false)
const uploadingKakao = ref(false)
const kakaoResult = ref(null)
const disconnecting = ref(false)
const showDisconnectConfirm = ref(false)

async function saveNickname() {
  try {
    await auth.updateNickname(nickname.value)
    alert('닉네임이 변경되었습니다')
  } catch (e) {
    alert('변경 실패: ' + e.message)
  }
}

async function createInvite() {
  try {
    const data = await couple.createInviteCode()
    generatedCode.value = data.code
  } catch (e) {
    alert('초대코드 생성 실패: ' + e.message)
  }
}

async function redeem() {
  redeemError.value = ''
  redeemSuccess.value = false
  try {
    await couple.redeemInviteCode(redeemCode.value.trim())
    redeemSuccess.value = true
    redeemCode.value = ''
  } catch (e) {
    redeemError.value = e.message || '코드가 유효하지 않습니다'
  }
}

async function disconnectCouple() {
  disconnecting.value = true
  try {
    await couple.disconnectCouple()
    showDisconnectConfirm.value = false
    alert('커플 연동이 해지되었습니다.')
  } catch (e) {
    alert('해지 실패: ' + e.message)
  }
  disconnecting.value = false
}

async function uploadKakaoTxt(event) {
  const file = event.target.files?.[0]
  if (!file) return

  uploadingKakao.value = true
  kakaoResult.value = null

  try {
    const path = `${couple.coupleId}/kakao/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage.from('uploads').upload(path, file)
    if (uploadError) throw uploadError

    const { data: upload } = await supabase.from('uploads').insert({
      couple_id: couple.coupleId,
      user_id: auth.userId,
      type: 'kakao_txt',
      storage_path: path
    }).select().single()

    const result = await api.parseKakaoTxt(upload.id)
    kakaoResult.value = result
  } catch (e) {
    kakaoResult.value = { error: e.message }
  }
  uploadingKakao.value = false
}

function copyCode() {
  navigator.clipboard?.writeText(generatedCode.value)
  alert('복사되었습니다')
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <PageHeader title="설정" />

    <div class="px-4 pb-8 space-y-4">
      <!-- Profile -->
      <CardWrapper>
        <h3 class="font-bold text-amber-900 mb-3">프로필</h3>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-full bg-amber-400/20 flex items-center justify-center text-amber-600 text-xl font-bold">
            {{ auth.profile?.nickname?.[0] || '?' }}
          </div>
          <div>
            <p class="font-medium text-amber-900">{{ auth.profile?.nickname }}</p>
            <p class="text-xs text-amber-500/70">{{ auth.user?.email }}</p>
            <p v-if="auth.isGuest" class="text-xs text-orange-400 font-medium">게스트 계정</p>
          </div>
        </div>
        <div class="flex gap-2">
          <input v-model="nickname" placeholder="닉네임"
            class="flex-1 bg-amber-50 text-amber-900 text-sm rounded-lg px-3 py-2 border border-amber-200 focus:border-amber-400 focus:outline-none" />
          <button @click="saveNickname" class="bg-amber-400 hover:bg-amber-500 text-white text-sm px-4 py-2 rounded-lg transition-colors font-medium">
            저장
          </button>
        </div>
      </CardWrapper>

      <!-- Couple Status -->
      <CardWrapper>
        <h3 class="font-bold text-amber-900 mb-3">커플 연동</h3>
        <div v-if="couple.isConnected" class="text-green-600 flex items-center gap-2 mb-3">
          <span class="w-2 h-2 rounded-full bg-green-500 pulse-online"></span>
          연결됨 — {{ couple.partner?.nickname || '상대방' }}
        </div>
        <div v-else class="text-amber-500 flex items-center gap-2 mb-3">
          <span class="w-2 h-2 rounded-full bg-amber-400"></span>
          미연결
        </div>

        <!-- Disconnect button -->
        <div v-if="couple.isConnected && !showDisconnectConfirm" class="mb-3">
          <button @click="showDisconnectConfirm = true"
            class="w-full bg-red-100 hover:bg-red-200 text-red-500 py-2.5 rounded-lg text-sm font-semibold transition-colors">
            커플 연동 해지
          </button>
        </div>

        <!-- Disconnect confirmation -->
        <div v-if="showDisconnectConfirm" class="mb-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <p class="text-red-600 text-sm font-medium mb-2">정말 커플 연동을 해지하시겠습니까?</p>
          <p class="text-red-500/70 text-xs mb-4">이전의 대화 내용, 일기, 지식 그래프 등 모든 데이터가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
          <div class="flex gap-2">
            <button @click="disconnectCouple" :disabled="disconnecting"
              class="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
              {{ disconnecting ? '해지 중...' : '해지하기' }}
            </button>
            <button @click="showDisconnectConfirm = false"
              class="flex-1 bg-amber-100 hover:bg-amber-200 text-amber-700 py-2 rounded-lg text-sm font-semibold transition-colors">
              취소
            </button>
          </div>
        </div>

        <!-- Create invite -->
        <div v-if="!couple.isConnected" class="space-y-3">
          <button @click="createInvite" class="w-full bg-amber-400 hover:bg-amber-500 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors">
            초대코드 생성
          </button>
          <div v-if="generatedCode" class="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p class="text-xs text-amber-600/70 mb-1">초대코드 (24시간 유효):</p>
            <div class="flex items-center gap-2">
              <code class="text-amber-600 text-lg font-mono flex-1">{{ generatedCode }}</code>
              <button @click="copyCode" class="text-xs bg-amber-200 text-amber-700 px-3 py-1 rounded-lg hover:bg-amber-300 transition-colors">복사</button>
            </div>
          </div>

          <div class="border-t border-amber-200 pt-3">
            <p class="text-sm text-amber-600/70 mb-2">상대방의 초대코드 입력</p>
            <div class="flex gap-2">
              <input v-model="redeemCode" placeholder="초대코드 입력"
                class="flex-1 bg-amber-50 text-amber-900 text-sm rounded-lg px-3 py-2 border border-amber-200 focus:border-amber-400 focus:outline-none" />
              <button @click="redeem" class="bg-orange-400 hover:bg-orange-500 text-white text-sm px-4 py-2 rounded-lg transition-colors font-medium">
                입력
              </button>
            </div>
            <p v-if="redeemError" class="text-red-400 text-xs mt-1">{{ redeemError }}</p>
            <p v-if="redeemSuccess" class="text-green-500 text-xs mt-1">커플 연동 완료!</p>
          </div>
        </div>
      </CardWrapper>

      <!-- Kakao Upload -->
      <CardWrapper v-if="couple.isConnected">
        <h3 class="font-bold text-amber-900 mb-3">카카오톡 대화 업로드</h3>
        <p class="text-xs text-amber-600/70 mb-3">카카오톡에서 내보낸 TXT 파일을 업로드하세요</p>
        <label class="block w-full bg-amber-100 hover:bg-amber-200 text-amber-700 font-semibold py-3 rounded-xl text-center cursor-pointer text-sm transition-colors">
          {{ uploadingKakao ? '업로드 중...' : 'TXT 파일 선택' }}
          <input type="file" accept=".txt" @change="uploadKakaoTxt" class="hidden" :disabled="uploadingKakao" />
        </label>
        <div v-if="kakaoResult" class="mt-3 text-sm">
          <div v-if="kakaoResult.error" class="text-red-400">{{ kakaoResult.error }}</div>
          <div v-else class="text-green-600">
            <p>{{ kakaoResult.message_count || 0 }}개 메시지 반영 완료</p>
            <p v-if="kakaoResult.dates" class="text-xs text-amber-500/70 mt-1">
              반영된 날짜: {{ kakaoResult.dates?.join(', ') }}
            </p>
          </div>
        </div>
      </CardWrapper>

      <!-- Admin Link -->
      <CardWrapper v-if="auth.isAdmin">
        <router-link to="/admin" class="flex items-center justify-between text-amber-900">
          <span class="font-bold">관리자 대시보드</span>
          <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </router-link>
      </CardWrapper>

      <!-- Logout -->
      <button @click="auth.signOut()"
        class="w-full text-amber-500 hover:text-red-500 text-sm py-3 transition-colors font-medium">
        로그아웃
      </button>
    </div>
  </div>
</template>
