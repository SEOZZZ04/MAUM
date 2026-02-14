import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { useRouter } from 'vue-router'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const profile = ref(null)
  const loading = ref(true)
  const isGuest = computed(() => !!user.value?.user_metadata?.is_guest)

  const isLoggedIn = computed(() => !!user.value)
  const isAdmin = computed(() => profile.value?.role === 'admin')
  const userId = computed(() => user.value?.id)

  async function init() {
    loading.value = true
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      user.value = session.user
      await fetchProfile()
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
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && user.value) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          user.value = session.user
        }
      }
    })
  }

  async function fetchProfile() {
    if (!user.value) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.value.id)
      .single()
    profile.value = data
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/'
      }
    })
    if (error) throw error
  }

  async function signInAsGuest() {
    // Generate or retrieve device-based guest credentials
    let guestId = localStorage.getItem('maum_guest_id')
    let guestPassword = localStorage.getItem('maum_guest_password')

    if (!guestId || !guestPassword) {
      // Generate a unique device-based ID
      const deviceFingerprint = generateDeviceFingerprint()
      guestId = `guest_${deviceFingerprint}@maum.guest`
      guestPassword = `guest_pw_${deviceFingerprint}_${Date.now()}`
      localStorage.setItem('maum_guest_id', guestId)
      localStorage.setItem('maum_guest_password', guestPassword)
    }

    // Try to sign in first
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: guestId,
      password: guestPassword
    })

    if (signInError) {
      // If login fails, sign up
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: guestId,
        password: guestPassword,
        options: {
          data: {
            is_guest: true,
            full_name: `Guest_${guestId.split('_')[1]?.substring(0, 6) || 'User'}`,
          }
        }
      })
      if (signUpError) throw signUpError
      user.value = signUpData.user

      // Update profile nickname for guest
      if (signUpData.user) {
        const guestNick = `Guest_${guestId.split('_')[1]?.substring(0, 6) || 'User'}`
        await supabase
          .from('profiles')
          .update({ nickname: guestNick })
          .eq('user_id', signUpData.user.id)
        await fetchProfile()
      }
    } else {
      user.value = signInData.user
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
