import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

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
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { name: 'Auth' }

  if (to.meta.admin) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', session.user.id)
      .single()
    if (profile?.role !== 'admin') return { name: 'Chat' }
  }

  return true
})

export default router
