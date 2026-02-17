import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/main.css'
import { initAnalytics } from './lib/analytics'

function normalizeLegacyHashRoute() {
  const { hash, search, pathname } = window.location

  // Legacy URLs like "#/notes" should be converted to history routes
  // so that auth callbacks and router navigation work consistently.
  if (!hash.startsWith('#/')) return

  const legacyPath = hash.slice(1)
  const routeMap = {
    '/notes': '/chat'
  }
  const targetPath = routeMap[legacyPath] || legacyPath

  // Avoid unnecessary history operations.
  if (pathname === targetPath) return

  window.history.replaceState({}, '', `${targetPath}${search}`)
}

normalizeLegacyHashRoute()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Initialize analytics (GA4, Clarity, Mixpanel)
initAnalytics()
