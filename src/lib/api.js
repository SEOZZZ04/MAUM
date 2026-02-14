import { supabase } from './supabase'

async function callEdgeFunction(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let errorMessage = error.message || 'Edge Function 호출 실패'

    // Detect common deployment issues
    if (error.message?.includes('non-2xx') || error.message?.includes('404') || error.message?.includes('FunctionsFetchError')) {
      errorMessage = `Edge Function '${name}'이(가) 배포되지 않았습니다. Supabase에서 Edge Function을 배포해주세요.`
      console.error(`[API] Edge Function '${name}' not deployed. Deploy with: supabase functions deploy ${name}`)
    }

    // Try to extract meaningful error message from response body
    if (error.context?.body) {
      try {
        const text = typeof error.context.body.text === 'function'
          ? await error.context.body.text()
          : (typeof error.context.body === 'string' ? error.context.body : null)
        if (text) {
          const parsed = JSON.parse(text)
          if (parsed.error) errorMessage = parsed.error
        }
      } catch {
        // JSON parsing failed - use the detected error message
      }
    }
    throw new Error(errorMessage)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

async function callRpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) {
    // Detect if the RPC function doesn't exist
    if (error.message?.includes('does not exist') || error.code === '42883') {
      throw new Error(`RPC 함수 '${name}'이(가) 존재하지 않습니다. SQL 마이그레이션을 실행해주세요.`)
    }
    throw new Error(error.message)
  }
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
    } catch (edgeError) {
      throw new Error(edgeError.message || rpcError.message)
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
