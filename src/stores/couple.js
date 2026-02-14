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
  let guestRequestsChannel = null
  let lobbyBroadcastChannel = null
  let coupleChannel = null
  let lobbyPollInterval = null

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

      subscribeToCoupleChannel(membership.couple_id)
    } else {
      couple.value = null
      partner.value = null
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

  // Disconnect couple
  async function disconnectCouple() {
    if (!coupleId.value) return

    const cid = coupleId.value

    // Broadcast disconnect to partner BEFORE deleting
    if (coupleChannel) {
      coupleChannel.send({
        type: 'broadcast',
        event: 'couple_disconnected',
        payload: {}
      })
      await new Promise(r => setTimeout(r, 300))
    }

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

    unsubscribeFromCoupleChannel()
    couple.value = null
    partner.value = null
  }

  // === Couple broadcast channel (for disconnect notifications) ===
  function subscribeToCoupleChannel(cid) {
    unsubscribeFromCoupleChannel()
    coupleChannel = supabase
      .channel(`couple:${cid}`)
      .on('broadcast', { event: 'couple_disconnected' }, () => {
        couple.value = null
        partner.value = null
        unsubscribeFromCoupleChannel()
      })
      .subscribe()
  }

  function unsubscribeFromCoupleChannel() {
    if (coupleChannel) {
      supabase.removeChannel(coupleChannel)
      coupleChannel = null
    }
  }

  // === Guest connection system ===
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

    // Broadcast to lobby so the target sees the request immediately
    if (lobbyBroadcastChannel) {
      lobbyBroadcastChannel.send({
        type: 'broadcast',
        event: 'lobby_update',
        payload: { type: 'new_request', to: targetUserId, from: auth.userId }
      })
    }
  }

  async function fetchPendingRequests() {
    const auth = useAuthStore()
    // Don't use PostgREST join on from_user_id - FK goes to auth.users, not profiles
    const { data, error } = await supabase
      .from('guest_connection_requests')
      .select('*')
      .eq('to_user_id', auth.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[fetchPendingRequests] error:', error)
      return []
    }

    // Fetch sender profiles separately
    const requests = data || []
    for (const req of requests) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('user_id', req.from_user_id)
        .single()
      req.from_profile = profile
    }

    pendingRequests.value = requests
    return requests
  }

  async function acceptConnectionRequest(requestId) {
    const auth = useAuthStore()
    const result = await api.acceptGuestConnection(requestId)
    await fetchCouple()

    // Broadcast so the requester knows immediately
    if (lobbyBroadcastChannel) {
      lobbyBroadcastChannel.send({
        type: 'broadcast',
        event: 'lobby_update',
        payload: { type: 'request_accepted', by: auth.userId }
      })
    }

    return result
  }

  async function rejectConnectionRequest(requestId) {
    await supabase
      .from('guest_connection_requests')
      .update({ status: 'rejected' })
      .eq('id', requestId)
    await fetchPendingRequests()
  }

  // === Real-time subscriptions ===

  function subscribeToGuestUpdates() {
    unsubscribeFromGuestUpdates()
    const auth = useAuthStore()

    // Channel 1: Postgres Changes for DB events (works when Supabase Realtime is configured)
    guestRequestsChannel = supabase
      .channel('guest-db-changes')
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
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        if (payload.old?.is_online !== payload.new?.is_online) {
          fetchOnlineGuests()
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'couple_members',
        filter: `user_id=eq.${auth.userId}`
      }, () => {
        fetchCouple()
      })
      .subscribe((status) => {
        console.log('[Realtime DB] status:', status)
      })

    // Channel 2: Broadcast for instant lobby notifications
    // (doesn't depend on Supabase Realtime publication config)
    lobbyBroadcastChannel = supabase
      .channel('guest-lobby')
      .on('broadcast', { event: 'lobby_update' }, (payload) => {
        const msg = payload.payload
        if (msg.type === 'new_request' && msg.to === auth.userId) {
          // Someone sent me a request
          fetchPendingRequests()
        } else if (msg.type === 'request_accepted') {
          // Someone accepted a request - check if my couple status changed
          fetchCouple()
        } else if (msg.type === 'guest_online' || msg.type === 'guest_offline') {
          fetchOnlineGuests()
        }
      })
      .subscribe((status) => {
        console.log('[Realtime Broadcast] status:', status)
      })

    // Channel 3: Periodic polling as safety net (every 5 seconds)
    startLobbyPolling()
  }

  function startLobbyPolling() {
    stopLobbyPolling()
    lobbyPollInterval = setInterval(async () => {
      // Only poll if not yet connected to a couple
      if (!isConnected.value) {
        await fetchOnlineGuests()
        await fetchPendingRequests()
      } else {
        // Connected - no need to poll lobby anymore
        stopLobbyPolling()
      }
    }, 5000)
  }

  function stopLobbyPolling() {
    if (lobbyPollInterval) {
      clearInterval(lobbyPollInterval)
      lobbyPollInterval = null
    }
  }

  function unsubscribeFromGuestUpdates() {
    if (guestRequestsChannel) {
      supabase.removeChannel(guestRequestsChannel)
      guestRequestsChannel = null
    }
    if (lobbyBroadcastChannel) {
      supabase.removeChannel(lobbyBroadcastChannel)
      lobbyBroadcastChannel = null
    }
    stopLobbyPolling()
  }

  // Broadcast online status change to lobby
  function broadcastPresence(isOnline) {
    if (lobbyBroadcastChannel) {
      const auth = useAuthStore()
      lobbyBroadcastChannel.send({
        type: 'broadcast',
        event: 'lobby_update',
        payload: {
          type: isOnline ? 'guest_online' : 'guest_offline',
          userId: auth.userId
        }
      })
    }
  }

  function cleanup() {
    unsubscribeFromGuestUpdates()
    unsubscribeFromCoupleChannel()
  }

  return {
    couple, partner, loading, onlineGuests, pendingRequests,
    coupleId, isConnected,
    fetchCouple, createInviteCode, redeemInviteCode, disconnectCouple,
    fetchOnlineGuests, sendConnectionRequest,
    fetchPendingRequests, acceptConnectionRequest, rejectConnectionRequest,
    subscribeToGuestUpdates, unsubscribeFromGuestUpdates,
    subscribeToCoupleChannel, unsubscribeFromCoupleChannel,
    broadcastPresence, cleanup
  }
})
