import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCoupleStore } from './couple'
import { api } from '../lib/api'

export const useChatStore = defineStore('chat', () => {
  const messages = ref([])
  const todayThread = ref(null)
  const loading = ref(false)
  const extractingGraph = ref(false)
  const initError = ref(null)
  let realtimeChannel = null
  let _subscribedDayId = null
  // Track messages since last graph extraction (persisted in sessionStorage)
  let _messagesSinceExtraction = parseInt(sessionStorage.getItem('maum_msg_count') || '0', 10)
  const EXTRACT_EVERY_N_MESSAGES = 5
  // Prevent concurrent initialization
  let _initPromise = null

  // Persist message counter across soft navigations
  function _persistMsgCount() {
    sessionStorage.setItem('maum_msg_count', String(_messagesSinceExtraction))
  }

  async function ensureTodayThread() {
    // 1) Try RPC/Edge Function first
    try {
      const data = await api.ensureTodayThread()
      const day = data?.day || data
      if (day?.id) {
        todayThread.value = day
        return day
      }
    } catch (e) {
      console.warn('ensureTodayThread RPC/Edge failed, trying direct query:', e.message)
    }

    // 2) Fallback: query conversation_days directly
    const couple = useCoupleStore()
    if (!couple.coupleId) throw new Error('커플이 연동되지 않았습니다')

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
    const todayStr = today.toISOString().split('T')[0]

    // Try to find existing non-archived day for today
    const { data: existingDay, error: findError } = await supabase
      .from('conversation_days')
      .select('*')
      .eq('couple_id', couple.coupleId)
      .eq('date', todayStr)
      .eq('archived', false)
      .maybeSingle()

    if (existingDay) {
      todayThread.value = existingDay
      return existingDay
    }

    // If no day exists, find the most recent non-archived day (could be yesterday if not yet archived)
    const { data: recentDay } = await supabase
      .from('conversation_days')
      .select('*')
      .eq('couple_id', couple.coupleId)
      .eq('archived', false)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentDay) {
      todayThread.value = recentDay
      return recentDay
    }

    // Last resort: create a new day directly
    const { data: newDay, error: insertError } = await supabase
      .from('conversation_days')
      .insert({
        couple_id: couple.coupleId,
        date: todayStr,
        title: todayStr,
        archived: false
      })
      .select()
      .single()

    if (insertError) throw new Error('대화방을 생성할 수 없습니다: ' + insertError.message)

    todayThread.value = newDay
    return newDay
  }

  async function loadMessages(dayId) {
    if (!dayId) return
    loading.value = true
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*, profiles:sender_user_id(nickname, avatar_url)')
        .eq('day_id', dayId)
        .order('created_at', { ascending: true })

      // Only replace messages if query succeeded - prevents data loss on stale connections
      if (!error && data) {
        messages.value = data
      } else if (error) {
        console.error('Failed to load messages:', error)
      }
    } catch (e) {
      console.error('Failed to load messages:', e)
    }
    loading.value = false
  }

  async function sendMessage(text) {
    const couple = useCoupleStore()
    if (!todayThread.value || !couple.coupleId) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('인증이 필요합니다')

    const { error } = await supabase.from('messages').insert({
      couple_id: couple.coupleId,
      day_id: todayThread.value.id,
      sender_user_id: user.id,
      text,
      source: 'chat'
    })
    if (error) throw error

    // Track message count for graph extraction
    _messagesSinceExtraction++
    _persistMsgCount()
    if (_messagesSinceExtraction >= EXTRACT_EVERY_N_MESSAGES) {
      triggerGraphExtraction()
    }
  }

  // Extract knowledge graph from recent messages
  async function triggerGraphExtraction() {
    if (extractingGraph.value) return
    if (messages.value.length < 3) return

    extractingGraph.value = true
    _messagesSinceExtraction = 0
    _persistMsgCount()

    try {
      // Gather last N messages as context for extraction
      const recentMessages = messages.value.slice(-10)
      const conversationText = recentMessages
        .map(m => `${m.profiles?.nickname || '?'}: ${m.text}`)
        .join('\n')

      const sourceInfo = {
        type: 'chat',
        day_id: todayThread.value?.id,
        date: todayThread.value?.date || new Date().toISOString().split('T')[0]
      }

      await api.extractGraph(conversationText, sourceInfo)
    } catch (e) {
      console.warn('Graph extraction failed:', e.message)
    }
    extractingGraph.value = false
  }

  function subscribeToMessages(dayId) {
    if (!dayId) return
    // Don't re-subscribe if already subscribed to this day
    if (_subscribedDayId === dayId && realtimeChannel) return
    unsubscribe()
    _subscribedDayId = dayId

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

        // Track incoming messages for graph extraction too
        _messagesSinceExtraction++
        _persistMsgCount()
        if (_messagesSinceExtraction >= EXTRACT_EVERY_N_MESSAGES) {
          triggerGraphExtraction()
        }
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
      _subscribedDayId = null
    }
  }

  // Full initialization - ensures thread, loads messages, subscribes
  async function initChat() {
    // Prevent concurrent initializations
    if (_initPromise) return _initPromise
    _initPromise = _doInitChat()
    try {
      return await _initPromise
    } finally {
      _initPromise = null
    }
  }

  async function _doInitChat() {
    initError.value = null
    try {
      const day = await ensureTodayThread()
      if (day) {
        await loadMessages(day.id)
        subscribeToMessages(day.id)
        return day
      }
    } catch (e) {
      console.error('Chat init error:', e)
      initError.value = e.message || '채팅 초기화 실패'

      // If ensureTodayThread failed but we have messages from before, keep them
      // Try to at least load messages from any existing thread
      const couple = useCoupleStore()
      if (couple.coupleId && !todayThread.value) {
        try {
          const { data: latestDay } = await supabase
            .from('conversation_days')
            .select('*')
            .eq('couple_id', couple.coupleId)
            .eq('archived', false)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (latestDay) {
            todayThread.value = latestDay
            await loadMessages(latestDay.id)
            subscribeToMessages(latestDay.id)
            initError.value = null
            return latestDay
          }
        } catch (fallbackErr) {
          console.error('Fallback thread load also failed:', fallbackErr)
        }
      }
    }
    return null
  }

  // Reconnect realtime after tab becomes visible again
  async function reconnect() {
    // Refresh auth session first
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        const { data } = await supabase.auth.refreshSession()
        if (!data.session) return
      }
    } catch {
      return
    }

    if (!todayThread.value) {
      // No thread yet - do full init
      return await initChat()
    }

    const dayId = todayThread.value.id

    // Force re-subscribe by clearing tracked day
    _subscribedDayId = null
    subscribeToMessages(dayId)

    // Reload messages
    await loadMessages(dayId)
  }

  async function archiveToday() {
    if (!todayThread.value) return
    await supabase
      .from('conversation_days')
      .update({ archived: true })
      .eq('id', todayThread.value.id)
    todayThread.value = null
    messages.value = []
    _messagesSinceExtraction = 0
  }

  return {
    messages, todayThread, loading, extractingGraph, initError,
    ensureTodayThread, loadMessages, sendMessage,
    subscribeToMessages, unsubscribe, reconnect,
    archiveToday, triggerGraphExtraction, initChat
  }
})
