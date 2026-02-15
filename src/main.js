import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './assets/main.css'
import { initAnalytics } from './lib/analytics'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Initialize analytics (GA4, Clarity, Mixpanel)
initAnalytics()
