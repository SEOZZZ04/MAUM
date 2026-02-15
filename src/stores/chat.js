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
  // Cache profiles to avoid repeated fetches
  const _profileCache = {}

  function _persistMsgCount() {
    sessionStorage.setItem('maum_msg_count', String(_messagesSinceExtraction))
  }

  // Fetch profile by user_id with caching
  async function _fetchProfile(userId) {
    if (!userId) return null
    if (_profileCache[userId]) return _profileCache[userId]

    try {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, nickname, avatar_url')
        .eq('user_id', userId)
        .single()
      if (data) {
        _profileCache[userId] = data
      }
      return data
    } catch {
      return null
    }
  }

  // Batch fetch profiles for multiple user IDs
  async function _fetchProfiles(userIds) {
    const unique = [...new Set(userIds.filter(Boolean))]
    const missing = unique.filter(id => !_profileCache[id])

    if (missing.length > 0) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('user_id, nickname, avatar_url')
          .in('user_id', missing)
        if (data) {
          for (const p of data) {
            _profileCache[p.user_id] = p
          }
        }
      } catch {
        // Profile fetch failed - continue without profiles
      }
    }

    const result = {}
    for (const id of unique) {
      result[id] = _profileCache[id] || null
    }
    return result
  }

  // Get KST date string (YYYY-MM-DD)
  function _getKSTDateStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  }

  async function ensureTodayThread() {
    const couple = useCoupleStore()
    if (!couple.coupleId) throw new Error('커플이 연동되지 않았습니다')

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
    const todayStr = _getKSTDateStr()

    // Try to find existing non-archived day for today
    const { data: existingDay } = await supabase
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

    // Find the most recent non-archived day (could be yesterday if not yet archived)
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
      // Fetch messages WITHOUT profile join (avoids PGRST200 FK error)
      // messages.sender_user_id references auth.users, NOT profiles,
      // so PostgREST cannot resolve the FK join
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('day_id', dayId)
        .order('created_at', { ascending: true })

      if (!error && data) {
        // Batch-fetch sender profiles separately
        const senderIds = data.map(m => m.sender_user_id)
        const profileMap = await _fetchProfiles(senderIds)

        // Attach profiles to each message
        messages.value = data.map(m => ({
          ...m,
          profiles: profileMap[m.sender_user_id] || null
        }))
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

  // Build a context summary from all messages to give the AI full conversation awareness
  function _buildContextSummary() {
    if (messages.value.length <= 10) return ''
    // Summarize earlier messages (before the last 10) as context
    const earlier = messages.value.slice(0, -10)
    const speakers = new Set()
    const topics = []
    for (const m of earlier) {
      if (m.profiles?.nickname) speakers.add(m.profiles.nickname)
      if (m.text?.length > 10) {
        topics.push(`${m.profiles?.nickname || '?'}: ${m.text.slice(0, 60)}`)
      }
    }
    const speakerList = [...speakers].join(', ')
    const topicSample = topics.slice(-10).join('\n')
    return `화자: ${speakerList}\n이전 대화 내용 일부:\n${topicSample}`
  }

  // Extract knowledge graph from recent messages
  async function triggerGraphExtraction() {
    if (extractingGraph.value) return
    if (messages.value.length < 3) return

    extractingGraph.value = true
    _messagesSinceExtraction = 0
    _persistMsgCount()

    try {
      // Send more messages (up to 20) with speaker info for better context
      const recentMessages = messages.value.slice(-20)
      const conversationText = recentMessages
        .map(m => `[${m.profiles?.nickname || '?'}]: ${m.text}`)
        .join('\n')

      const contextSummary = _buildContextSummary()

      const sourceInfo = {
        type: 'chat',
        day_id: todayThread.value?.id,
        date: todayThread.value?.date || _getKSTDateStr()
      }

      await api.extractGraph(conversationText, sourceInfo, contextSummary)
    } catch (e) {
      console.warn('Graph extraction failed:', e.message)
    }
    extractingGraph.value = false
  }

  function subscribeToMessages(dayId) {
    if (!dayId) return
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
        if (messages.value.some(m => m.id === payload.new.id)) return

        // Fetch sender profile separately (not via FK join)
        const profileData = await _fetchProfile(payload.new.sender_user_id)

        // Check again after async fetch to prevent race condition duplicates
        if (messages.value.some(m => m.id === payload.new.id)) return
        messages.value.push({ ...payload.new, profiles: profileData })

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

  async function initChat() {
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

      // Fallback: try to load messages from any existing thread
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

  async function reconnect() {
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
      return await initChat()
    }

    const dayId = todayThread.value.id
    _subscribedDayId = null
    subscribeToMessages(dayId)
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
