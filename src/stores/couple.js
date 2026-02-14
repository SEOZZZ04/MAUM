import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth'
import { api } from '../lib/api'

export const useCoupleStore = defineStore('couple', () => {
  const couple = ref(null)
  const partner = ref(null)
  const loading = ref(false)

  const coupleId = computed(() => couple.value?.id)
  const isConnected = computed(() => !!couple.value)

  async function fetchCouple() {
    const auth = useAuthStore()
    if (!auth.userId) return

    loading.value = true

    const { data: membership } = await supabase
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (membership) {
      const { data: coupleData } = await supabase
        .from('couples')
        .select('*')
        .eq('id', membership.couple_id)
        .single()
      couple.value = coupleData

      const { data: members } = await supabase
        .from('couple_members')
        .select('user_id')
        .eq('couple_id', membership.couple_id)

      const partnerMember = members?.find(m => m.user_id !== auth.userId)
      if (partnerMember) {
        const { data: partnerProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', partnerMember.user_id)
          .single()
        partner.value = partnerProfile
      }
    }
    loading.value = false
  }

  async function createInviteCode() {
    return await api.createInviteCode()
  }

  async function redeemInviteCode(code) {
    const result = await api.redeemInviteCode(code)
    await fetchCouple()
    return result
  }

  return {
    couple, partner, loading,
    coupleId, isConnected,
    fetchCouple, createInviteCode, redeemInviteCode
  }
})
