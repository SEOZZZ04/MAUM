import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { identifyUser } from '../lib/analytics'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const loading = ref(true)
  const isGuest = computed(() => !!user.value?.user_metadata?.is_guest)

  const isLoggedIn = computed(() => !!user.value)
  const isAdmin = computed(() => profile.value?.role === 'admin')
  const userId = computed(() => user.value?.id)

  let _visibilityHandlerAdded = false

  async function init() {
    loading.value = true
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        user.value = session.user
        await fetchProfile()
      }
    } catch (e) {
      console.error('Auth init error:', e)
    }
    loading.value = false

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        user.value = session.user
        await fetchProfile()
      } else if (event === 'SIGNED_OUT') {
        user.value = null
        profile.value = null
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        user.value = session.user
      }
    })

    // Handle visibility change - refresh session when returning to tab
    // Only add once to prevent duplicate listeners
    if (!_visibilityHandlerAdded) {
      _visibilityHandlerAdded = true
      let _refreshing = false
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && user.value && !_refreshing) {
          _refreshing = true
          try {
            // Try getSession first (uses cached/stored session)
            let { data: { session } } = await supabase.auth.getSession()
            if (session?.user) {
              user.value = session.user
            } else {
              // If no session found, try refreshing the token
              const { data } = await supabase.auth.refreshSession()
              if (data.session?.user) {
                user.value = data.session.user
              }
            }
          } catch (e) {
            console.error('Session refresh error:', e)
          } finally {
            _refreshing = false
          }
        }
      })
    }
  }

  async function fetchProfile() {
    if (!user.value) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.value.id)
      .single()
    profile.value = data

    // Identify user for analytics
    if (data) {
      identifyUser(user.value.id, {
        nickname: data.nickname,
        role: data.role
      })
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth'
      }
    })
    if (error) throw error
  }

  async function signInAsGuest() {
    // Clean up old email/password based credentials (no longer needed)
    localStorage.removeItem('maum_guest_id')
    localStorage.removeItem('maum_guest_password')

    // Use Supabase Anonymous Sign-In (no email/password needed)
    const { data, error } = await supabase.auth.signInAnonymously({
      options: {
        data: {
          is_guest: true,
          device_fingerprint: generateDeviceFingerprint()
        }
      }
    })

    if (error) throw error

    user.value = data.user

    // Create/update profile for guest user
    if (data.user) {
      const guestNick = `Guest_${data.user.id.substring(0, 6)}`

      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', data.user.id)
        .single()

      if (!existingProfile) {
        // Create new profile
        await supabase
          .from('profiles')
          .insert({
            user_id: data.user.id,
            nickname: guestNick
          })
      } else {
        // Update existing profile
        await supabase
          .from('profiles')
          .update({ nickname: guestNick })
          .eq('user_id', data.user.id)
      }

      await fetchProfile()
    }
  }

  function generateDeviceFingerprint() {
    const nav = window.navigator
    const screen = window.screen
    const parts = [
      nav.userAgent,
      nav.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      nav.hardwareConcurrency || 'unknown'
    ]
    // Simple hash
    let hash = 0
    const str = parts.join('|')
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
    profile.value = null
  }

  async function updateNickname(nickname) {
    if (!user.value) return
    const { error } = await supabase
      .from('profiles')
      .update({ nickname })
      .eq('user_id', user.value.id)
    if (error) throw error
    profile.value = { ...profile.value, nickname }
  }

  // Guest presence management
  async function setGuestOnline() {
    if (!user.value || !isGuest.value) return
    await supabase
      .from('profiles')
      .update({ is_online: true, last_seen_at: new Date().toISOString() })
      .eq('user_id', user.value.id)
  }

  async function setGuestOffline() {
    if (!user.value || !isGuest.value) return
    await supabase
      .from('profiles')
      .update({ is_online: false })
      .eq('user_id', user.value.id)
  }

  async function fetchOnlineGuests() {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, nickname, is_online, last_seen_at')
      .eq('is_online', true)
      .neq('user_id', user.value?.id)
    return data || []
  }

  return {
    user, profile, loading,
    isLoggedIn, isAdmin, userId, isGuest,
    init, fetchProfile, signInWithGoogle, signInAsGuest,
    signOut, updateNickname,
    setGuestOnline, setGuestOffline, fetchOnlineGuests
  }
})
