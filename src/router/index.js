import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'
import { trackPageView } from '../lib/analytics'

const routes = [
  {
    path: '/auth',
    name: 'Auth',
    component: () => import('../views/AuthView.vue'),
    meta: { public: true }
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('../views/ChatView.vue')
  },
  {
    path: '/archive',
    name: 'Archive',
    component: () => import('../views/ArchiveView.vue')
  },
  {
    path: '/archive/:dayId',
    name: 'ArchiveDetail',
    component: () => import('../views/ArchiveDetailView.vue'),
    props: true
  },
  {
    path: '/graph',
    name: 'Graph',
    component: () => import('../views/GraphView.vue')
  },
  {
    path: '/diary',
    name: 'Diary',
    component: () => import('../views/DiaryView.vue')
  },
  {
    path: '/diary/call/:callId',
    name: 'CallDetail',
    component: () => import('../views/CallDetailView.vue'),
    props: true
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue')
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../views/AdminView.vue'),
    meta: { admin: true }
  },
  {
    path: '/',
    redirect: '/chat'
  },
  // Catch-all: redirect unknown routes to /chat
  {
    path: '/:pathMatch(.*)*',
    redirect: '/chat'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Track if initial auth check is done
let authInitialized = false
let authResolve = null
const authReady = new Promise(resolve => { authResolve = resolve })

// Listen for auth state changes
supabase.auth.onAuthStateChange((event) => {
  if (!authInitialized) {
    authInitialized = true
    authResolve()
  }
  // After OAuth callback redirect, navigate to chat
  if (event === 'SIGNED_IN' && router.currentRoute.value.path === '/auth') {
    router.push('/chat')
  }
})

// Also resolve after getSession
supabase.auth.getSession().then(() => {
  if (!authInitialized) {
    authInitialized = true
    authResolve()
  }
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true

  // Wait for auth to be initialized
  await authReady

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { name: 'Auth' }

  if (to.meta.admin) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (profile?.role !== 'admin') return { name: 'Chat' }
  }

  return true
})

// Track page views for analytics
router.afterEach((to) => {
  trackPageView(to.fullPath, to.name || to.path)
})

export default router
