import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { useAuthStore } from './auth'
import { api } from '../lib/api'

export const useCoupleStore = defineStore('couple', () => {
  const couple = ref(null)
  const partner = ref(null)
  const loading = ref(false)
  const onlineGuests = ref([])
  const pendingRequests = ref([])
  let guestChannel = null

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

  // Disconnect couple - delete all shared data
  async function disconnectCouple() {
    if (!coupleId.value) return

    const cid = coupleId.value

    // Delete all couple data in order (respecting foreign keys)
    await supabase.from('graph_edges').delete().eq('couple_id', cid)
    await supabase.from('graph_nodes').delete().eq('couple_id', cid)
    await supabase.from('daily_summaries').delete().eq('couple_id', cid)
    await supabase.from('call_logs').delete().eq('couple_id', cid)
    await supabase.from('uploads').delete().eq('couple_id', cid)
    await supabase.from('messages').delete().eq('couple_id', cid)
    await supabase.from('conversation_days').delete().eq('couple_id', cid)
    await supabase.from('couple_invites').delete().eq('couple_id', cid)
    await supabase.from('couple_members').delete().eq('couple_id', cid)
    await supabase.from('couples').delete().eq('id', cid)

    couple.value = null
    partner.value = null
  }

  // Guest connection system
  async function fetchOnlineGuests() {
    const auth = useAuthStore()
    const { data } = await supabase
      .from('profiles')
      .select('user_id, nickname, is_online, last_seen_at')
      .eq('is_online', true)
      .neq('user_id', auth.userId)
    onlineGuests.value = data || []
    return data || []
  }

  async function sendConnectionRequest(targetUserId) {
    const auth = useAuthStore()
    const { error } = await supabase.from('guest_connection_requests').insert({
      from_user_id: auth.userId,
      to_user_id: targetUserId,
      status: 'pending'
    })
    if (error) throw error
  }

  async function fetchPendingRequests() {
    const auth = useAuthStore()
    const { data } = await supabase
      .from('guest_connection_requests')
      .select('*, from_profile:from_user_id(nickname)')
      .eq('to_user_id', auth.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    pendingRequests.value = data || []
    return data || []
  }

  async function acceptConnectionRequest(requestId) {
    const auth = useAuthStore()

    // Get the request
    const { data: request } = await supabase
      .from('guest_connection_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (!request) throw new Error('요청을 찾을 수 없습니다')

    // Create a couple
    const { data: newCouple, error: coupleError } = await supabase
      .from('couples')
      .insert({})
      .select()
      .single()
    if (coupleError) throw coupleError

    // Add both members
    await supabase.from('couple_members').insert([
      { couple_id: newCouple.id, user_id: request.from_user_id },
      { couple_id: newCouple.id, user_id: auth.userId }
    ])

    // Update request status
    await supabase
      .from('guest_connection_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId)

    // Refresh couple data
    await fetchCouple()
  }

  async function rejectConnectionRequest(requestId) {
    await supabase
      .from('guest_connection_requests')
      .update({ status: 'rejected' })
      .eq('id', requestId)
    await fetchPendingRequests()
  }

  // Subscribe to real-time guest updates
  function subscribeToGuestUpdates() {
    unsubscribeFromGuestUpdates()
    const auth = useAuthStore()

    guestChannel = supabase
      .channel('guest-requests')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'guest_connection_requests',
        filter: `to_user_id=eq.${auth.userId}`
      }, () => {
        fetchPendingRequests()
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'guest_connection_requests',
        filter: `from_user_id=eq.${auth.userId}`
      }, (payload) => {
        if (payload.new.status === 'accepted') {
          fetchCouple()
        }
      })
      .subscribe()
  }

  function unsubscribeFromGuestUpdates() {
    if (guestChannel) {
      supabase.removeChannel(guestChannel)
      guestChannel = null
    }
  }

  return {
    couple, partner, loading, onlineGuests, pendingRequests,
    coupleId, isConnected,
    fetchCouple, createInviteCode, redeemInviteCode, disconnectCouple,
    fetchOnlineGuests, sendConnectionRequest,
    fetchPendingRequests, acceptConnectionRequest, rejectConnectionRequest,
    subscribeToGuestUpdates, unsubscribeFromGuestUpdates
  }
})
