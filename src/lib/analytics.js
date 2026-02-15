/**
 * Analytics integrations: GA4, Microsoft Clarity, Mixpanel
 *
 * All three services are loaded via their JS snippets. The measurement IDs
 * are read from environment variables so they can be configured per deploy.
 *
 * Environment variables:
 *   VITE_GA4_MEASUREMENT_ID     – e.g. "G-XXXXXXXXXX"
 *   VITE_CLARITY_PROJECT_ID     – e.g. "abcdefghij"
 *   VITE_MIXPANEL_TOKEN         – e.g. "your-mixpanel-project-token"
 */

// ──────────────────────────────────────────────
// Google Analytics 4
// ──────────────────────────────────────────────
function initGA4() {
  const id = import.meta.env.VITE_GA4_MEASUREMENT_ID
  if (!id) return

  // Load gtag.js
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag
  gtag('js', new Date())
  gtag('config', id, { send_page_view: false }) // we'll send page views manually via router
}

export function trackPageView(path, title) {
  if (window.gtag) {
    window.gtag('event', 'page_view', {
      page_path: path,
      page_title: title
    })
  }
  // Mixpanel
  if (window.mixpanel) {
    window.mixpanel.track('Page View', { path, title })
  }
}

export function trackEvent(eventName, params = {}) {
  if (window.gtag) {
    window.gtag('event', eventName, params)
  }
  if (window.mixpanel) {
    window.mixpanel.track(eventName, params)
  }
}

// ──────────────────────────────────────────────
// Microsoft Clarity
// ──────────────────────────────────────────────
function initClarity() {
  const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID
  if (!projectId) return

  // Official Clarity snippet
  ;(function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", projectId)
}

// ──────────────────────────────────────────────
// Mixpanel
// ──────────────────────────────────────────────
function initMixpanel() {
  const token = import.meta.env.VITE_MIXPANEL_TOKEN
  if (!token) return

  // Official Mixpanel JS snippet (lite)
  ;(function(f,b){if(!b.__SV){var e,g,i,h;window.mixpanel=b;b._i=[];
  b.init=function(e,f,c){function g(a,d){var b=d.split(".");2===b.length&&(a=a[b[0]],d=b[1]);
  a[d]=function(){a.push([d].concat(Array.prototype.slice.call(arguments,0)))}}var a=b;
  "undefined"!==typeof c?a=b[c]=[]:c="mixpanel";a.people=a.people||[];a.toString=function(a){
  var d="mixpanel";"mixpanel"!==c&&(d+="."+c);a||(d+=" (stub)");return d};a.people.toString=
  function(){return a.toString(1)+".people (stub)"};
  i="disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove".split(" ");
  for(h=0;h<i.length;h++)g(a,i[h]);var j="set set_once union unset remove delete".split(" ");
  a.get_group=function(){function b(c){d[c]=function(){call2_args=arguments;
  call2=[c].concat(Array.prototype.slice.call(call2_args,0));a.push([e,call2])}}for(var d={},
  e=["get_group"].concat(Array.prototype.slice.call(arguments,0)),c=0;c<j.length;c++)b(j[c]);
  return d};b._i.push([e,f,c])};b.__SV=1.2;e=f.createElement("script");e.type="text/javascript";
  e.async=!0;e.src="undefined"!==typeof MIXPANEL_CUSTOM_LIB_URL?MIXPANEL_CUSTOM_LIB_URL:
  "file:"===f.location.protocol&&"//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js".match(/^\/\//)
  ?"https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js":"//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";
  g=f.getElementsByTagName("script")[0];g.parentNode.insertBefore(e,g)}})(document,window.mixpanel||[]);

  window.mixpanel.init(token, {
    track_pageview: false,
    persistence: 'localStorage'
  })
}

// ──────────────────────────────────────────────
// Public initializer – call once from main.js
// ──────────────────────────────────────────────
export function initAnalytics() {
  if (typeof window === 'undefined') return
  initGA4()
  initClarity()
  initMixpanel()
}

// Identify user (call after login)
export function identifyUser(userId, properties = {}) {
  if (window.mixpanel) {
    window.mixpanel.identify(userId)
    window.mixpanel.people.set(properties)
  }
  // Clarity custom tags
  if (window.clarity) {
    window.clarity('set', 'userId', userId)
    if (properties.nickname) {
      window.clarity('set', 'nickname', properties.nickname)
    }
  }
  // GA4 user properties
  if (window.gtag) {
    window.gtag('set', 'user_properties', {
      user_id: userId,
      ...properties
    })
  }
}
