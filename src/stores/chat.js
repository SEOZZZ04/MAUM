import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCoupleStore } from './couple'
import { api } from '../lib/api'

export const useChatStore = defineStore('chat', () => {
  const messages = ref([])
  const todayThread = ref(null)
  const loading = ref(false)
  let realtimeChannel = null

  async function ensureTodayThread() {
    const data = await api.ensureTodayThread()
    todayThread.value = data.day
    return data.day
  }

  async function loadMessages(dayId) {
    loading.value = true
    const { data } = await supabase
      .from('messages')
      .select('*, profiles:sender_user_id(nickname, avatar_url)')
      .eq('day_id', dayId)
      .order('created_at', { ascending: true })
    messages.value = data || []
    loading.value = false
  }

  async function sendMessage(text) {
    const couple = useCoupleStore()
    if (!todayThread.value || !couple.coupleId) return

    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase.from('messages').insert({
      couple_id: couple.coupleId,
      day_id: todayThread.value.id,
      sender_user_id: user.id,
      text,
      source: 'chat'
    })
    if (error) throw error
  }

  function subscribeToMessages(dayId) {
    unsubscribe()
    realtimeChannel = supabase
      .channel(`messages:${dayId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `day_id=eq.${dayId}`
      }, async (payload) => {
        // Prevent duplicate messages
        if (messages.value.some(m => m.id === payload.new.id)) return

        // Fetch sender profile
        let profileData = null
        try {
          const { data } = await supabase
            .from('profiles')
            .select('nickname, avatar_url')
            .eq('user_id', payload.new.sender_user_id)
            .single()
          profileData = data
        } catch {
          // Profile fetch failed (RLS or network) - still show the message
        }
        // Check again after async fetch to prevent race condition duplicates
        if (messages.value.some(m => m.id === payload.new.id)) return
        messages.value.push({ ...payload.new, profiles: profileData })
      })
      .subscribe((status, err) => {
        if (err) {
          console.error('Message subscription error:', err)
        }
      })
  }

  function unsubscribe() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel)
      realtimeChannel = null
    }
  }

  async function archiveToday() {
    if (!todayThread.value) return
    await supabase
      .from('conversation_days')
      .update({ archived: true })
      .eq('id', todayThread.value.id)
    todayThread.value = null
    messages.value = []
  }

  return {
    messages, todayThread, loading,
    ensureTodayThread, loadMessages, sendMessage,
    subscribeToMessages, unsubscribe, archiveToday
  }
})
