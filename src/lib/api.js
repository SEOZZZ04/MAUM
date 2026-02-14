import { supabase } from './supabase'

async function callEdgeFunction(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    // Try to extract the actual error message from the response
    if (error.context?.body) {
      try {
        const text = await error.context.body.text?.() || error.context.body
        const parsed = JSON.parse(typeof text === 'string' ? text : JSON.stringify(text))
        if (parsed.error) throw new Error(parsed.error)
      } catch (parseErr) {
        if (parseErr.message && parseErr.message !== 'Unexpected token') throw parseErr
      }
    }
    throw new Error(error.message || 'Edge Function 호출 실패')
  }
  // Handle case where data contains an error
  if (data?.error) throw new Error(data.error)
  return data
}

export const api = {
  // Invite codes
  createInviteCode: () => callEdgeFunction('create-invite-code'),
  redeemInviteCode: (code) => callEdgeFunction('redeem-invite-code', { code }),

  // Guest connection
  acceptGuestConnection: (requestId) => callEdgeFunction('accept-guest-connection', { request_id: requestId }),

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
