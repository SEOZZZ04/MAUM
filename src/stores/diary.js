import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import { useCoupleStore } from './couple'
import { api } from '../lib/api'

export const useDiaryStore = defineStore('diary', () => {
  const summaries = ref([])
  const callLogs = ref([])
  const loading = ref(false)

  async function fetchSummaries() {
    const couple = useCoupleStore()
    if (!couple.coupleId) return
    loading.value = true

    const { data } = await supabase
      .from('daily_summaries')
      .select('*')
      .eq('couple_id', couple.coupleId)
      .order('date', { ascending: false })
    summaries.value = data || []
    loading.value = false
  }

  async function generateSummary(date) {
    return await api.generateDailySummary(date)
  }

  async function updateSummaryTitle(id, titleOverride) {
    await supabase
      .from('daily_summaries')
      .update({ title_override: titleOverride })
      .eq('id', id)
    const idx = summaries.value.findIndex(s => s.id === id)
    if (idx >= 0) summaries.value[idx].title_override = titleOverride
  }

  async function updateSummaryContent(id, diaryText) {
    const { error } = await supabase
      .from('daily_summaries')
      .update({ diary_text: diaryText })
      .eq('id', id)
    if (error) throw error
    const idx = summaries.value.findIndex(s => s.id === id)
    if (idx >= 0) summaries.value[idx].diary_text = diaryText
  }

  async function deleteSummary(id) {
    const { error } = await supabase
      .from('daily_summaries')
      .delete()
      .eq('id', id)
    if (error) throw error
    summaries.value = summaries.value.filter(s => s.id !== id)
  }

  async function fetchCallLogs() {
    const couple = useCoupleStore()
    if (!couple.coupleId) return

    const { data } = await supabase
      .from('call_logs')
      .select('*')
      .eq('couple_id', couple.coupleId)
      .order('occurred_at', { ascending: false })
    callLogs.value = data || []
  }

  return {
    summaries, callLogs, loading,
    fetchSummaries, generateSummary, updateSummaryTitle,
    updateSummaryContent, deleteSummary, fetchCallLogs
  }
})
