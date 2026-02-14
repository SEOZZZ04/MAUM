import { supabase } from './supabase'

async function callEdgeFunction(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
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
  if (data?.error) throw new Error(data.error)
  return data
}

async function callRpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(error.message)
  return data
}

// Try RPC first (database function), fall back to edge function
async function callWithFallback(rpcName, rpcParams, edgeName, edgeBody) {
  try {
    return await callRpc(rpcName, rpcParams)
  } catch (rpcError) {
    console.warn(`RPC ${rpcName} failed, trying edge function:`, rpcError.message)
    try {
      return await callEdgeFunction(edgeName, edgeBody)
    } catch {
      throw rpcError
    }
  }
}

export const api = {
  // Connection operations — use RPC (database functions) with edge function fallback
  createInviteCode: () =>
    callWithFallback('create_invite_code', {}, 'create-invite-code', {}),

  redeemInviteCode: (code) =>
    callWithFallback('redeem_invite_code', { p_code: code }, 'redeem-invite-code', { code }),

  acceptGuestConnection: (requestId) =>
    callWithFallback('accept_guest_connection', { p_request_id: requestId }, 'accept-guest-connection', { request_id: requestId }),

  ensureTodayThread: () =>
    callWithFallback('ensure_today_thread', {}, 'ensure-today-thread', {}),

  // AI features — edge functions only (require OpenAI)
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
