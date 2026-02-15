/**
 * Global visibility/reconnection manager.
 *
 * When the browser tab goes to background, modern browsers throttle JS timers
 * and may tear down idle WebSocket connections. On return the Supabase realtime
 * channels can be stale. This module:
 *   1. Detects visibility changes (document.visibilitychange)
 *   2. Refreshes the auth session so tokens are valid
 *   3. Re-subscribes all Supabase realtime channels
 *   4. Lets individual stores hook into the "resume" event
 */
import { supabase } from './supabase'

const _listeners = []
let _installed = false
let _reconnecting = false
// Track when the tab was hidden so we know how long it was away
let _hiddenAt = null

/** Register a callback to run when the tab becomes visible again. */
export function onTabResume(fn) {
  _listeners.push(fn)
}

/** Remove a previously registered callback. */
export function offTabResume(fn) {
  const idx = _listeners.indexOf(fn)
  if (idx !== -1) _listeners.splice(idx, 1)
}

/**
 * Install the global handler (call once from App.vue).
 * Safe to call multiple times – only installs once.
 */
export function installReconnectHandler() {
  if (_installed) return
  _installed = true

  document.addEventListener('visibilitychange', handleVisibilityChange)
  // Also handle the page regaining focus (covers iOS edge cases)
  window.addEventListener('focus', handleFocusResume)
  // Online event – reconnect when network comes back
  window.addEventListener('online', handleOnlineResume)
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    _hiddenAt = Date.now()
    return
  }
  // visible
  await doReconnect()
}

async function handleFocusResume() {
  // Only trigger if we were away for more than 3 seconds
  if (_hiddenAt && Date.now() - _hiddenAt > 3000) {
    await doReconnect()
  }
}

async function handleOnlineResume() {
  await doReconnect()
}

async function doReconnect() {
  if (_reconnecting) return
  _reconnecting = true
  _hiddenAt = null

  try {
    // 1. Refresh auth session
    let session = null
    try {
      const { data } = await supabase.auth.getSession()
      session = data?.session
      if (!session) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        session = refreshed?.session
      }
    } catch {
      // auth refresh failed – user may have logged out
    }

    // 2. Reconnect Supabase realtime transport
    // Supabase JS v2 exposes the realtime client which manages the WS.
    // Calling `removeAllChannels` then re-subscribing is too heavy.
    // Instead we leverage the built-in heartbeat; but if it's dead
    // we can nudge it by accessing the connection.
    try {
      const rt = supabase.realtime
      if (rt && typeof rt.connect === 'function') {
        // If the socket is closed, reconnect
        if (rt.conn?.readyState !== 1 /* OPEN */) {
          rt.disconnect()
          rt.connect()
        }
      }
    } catch {
      // Realtime nudge failed – store callbacks will handle their own re-subscribe
    }

    // 3. Notify registered stores / components
    for (const fn of _listeners) {
      try {
        await fn(session)
      } catch (err) {
        console.warn('[reconnect] listener error:', err)
      }
    }
  } finally {
    _reconnecting = false
  }
}
