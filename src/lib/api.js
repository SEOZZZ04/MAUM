import { supabase } from './supabase'

async function callEdgeFunction(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })
  if (error) throw error
  return data
}

export const api = {
  // Invite codes
  createInviteCode: () => callEdgeFunction('create-invite-code'),
  redeemInviteCode: (code) => callEdgeFunction('redeem-invite-code', { code }),

  // Today thread
  ensureTodayThread: () => callEdgeFunction('ensure-today-thread'),

  // AI features
  generateDayTitle: (dayId) => callEdgeFunction('generate-day-title', { day_id: dayId }),
  generateDailySummary: (date) => callEdgeFunction('generate-daily-summary', { date }),
  extractGraph: (text, sourceInfo) => callEdgeFunction('extract-graph', { text, source_info: sourceInfo }),
  analyzeQuestion: (question) => callEdgeFunction('analyze-question', { question }),

  // Uploads
  parseKakaoTxt: (uploadId) => callEdgeFunction('parse-kakao-txt', { upload_id: uploadId }),
  analyzeCallAudio: (uploadId) => callEdgeFunction('analyze-call-audio', { upload_id: uploadId }),

  // Admin
  getAdminMetrics: () => callEdgeFunction('admin-metrics')
}
