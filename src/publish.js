'use strict'

const fs = require('fs')
const path = require('path')

// Publish a plugin update to the Otzaria store. Mirrors the browser flow,
// since the store has no token-based API: fetch a CSRF token, log in via the
// NextAuth credentials provider to get a session cookie, then PUT the update.
//
// NOTE: this depends on NextAuth internals (cookie names, the /api/auth/csrf
// and /callback/credentials endpoints). A NextAuth major upgrade on the site
// could break it.

// Minimal cookie jar: keep the latest value per cookie name across requests.
class CookieJar {
  constructor() {
    this.cookies = new Map()
  }
  store(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
    for (const raw of setCookies) {
      const pair = raw.split(';')[0]
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '' || value === 'deleted') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function fetchWithCookies(jar, url, options = {}) {
  const headers = { ...(options.headers || {}) }
  const cookie = jar.header()
  if (cookie) headers.cookie = cookie
  const res = await fetch(url, { ...options, headers })
  jar.store(res)
  return res
}

/**
 * @param {object} args
 * @param {string} args.baseUrl       store base, e.g. https://otzaria.org
 * @param {string} args.user          OTZARIA_USER (email or username)
 * @param {string} args.password      OTZARIA_PASSWORD
 * @param {string} args.pluginId      OTZARIA_PLUGIN_ID (the store's Mongo _id)
 * @param {string} args.pluginFile    path to the built .otzplugin
 * @param {string} args.version       new version (from manifest)
 * @param {(m:string)=>void} args.log
 * @returns {Promise<{published:boolean, skipped:boolean, pendingApproval:boolean, message:string}>}
 */
async function publishToStore({ baseUrl, user, password, pluginId, pluginFile, version, log = () => {} }) {
  const base = (baseUrl || 'https://otzaria.org').replace(/\/+$/, '')
  const jar = new CookieJar()

  // 1) CSRF token.
  const csrfRes = await fetchWithCookies(jar, `${base}/api/auth/csrf`, {
    headers: { 'User-Agent': 'otzaria-plugin-validator-action' },
  })
  if (!csrfRes.ok) throw new Error(`קבלת CSRF נכשלה: HTTP ${csrfRes.status}`)
  const { csrfToken } = await csrfRes.json()
  if (!csrfToken) throw new Error('לא התקבל csrfToken מהשרת')

  // 2) Credentials login.
  const loginBody = new URLSearchParams({
    csrfToken,
    identifier: user,
    password,
    callbackUrl: `${base}/`,
    json: 'true',
  })
  await fetchWithCookies(jar, `${base}/api/auth/callback/credentials`, {
    method: 'POST',
    body: loginBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })

  // 3) Verify session.
  const sessionRes = await fetchWithCookies(jar, `${base}/api/auth/session`)
  const session = await sessionRes.json().catch(() => ({}))
  if (!session || !session.user) {
    throw new Error('ההתחברות נכשלה: session ריק (בדוק את OTZARIA_USER / OTZARIA_PASSWORD)')
  }
  log(`מחובר כ-${session.user.email || session.user.name || 'משתמש'}`)

  // 4) Current plugin fields.
  const editUrl = `${base}/api/admin/plugins/${encodeURIComponent(pluginId)}/edit`
  const currentRes = await fetchWithCookies(jar, editUrl)
  if (currentRes.status === 401) throw new Error('אין הרשאה (401) — ה-session לא תקף')
  if (currentRes.status === 403) throw new Error('אין בעלות על התוסף (403) — המשתמש אינו היוצר/מנהל')
  if (currentRes.status === 404) throw new Error(`התוסף ${pluginId} לא נמצא בחנות (404) — בדוק את OTZARIA_PLUGIN_ID`)
  if (!currentRes.ok) throw new Error(`שליפת התוסף הנוכחי נכשלה: HTTP ${currentRes.status}`)
  const current = await currentRes.json()
  log(`גרסה נוכחית בחנות: ${current.version} ← חדשה: ${version}`)

  if (current.version === version) {
    return { published: false, skipped: true, pendingApproval: false, message: `החנות כבר בגרסה ${version} — דילוג` }
  }

  // 5) Build multipart and PUT. Carry over current fields; the manifest in the
  //    uploaded file overrides name/author/version/etc on the server anyway.
  const buf = fs.readFileSync(pluginFile)
  const form = new FormData()
  form.set('name', current.name ?? '')
  form.set('shortDescription', current.shortDescription ?? '')
  form.set('description', current.description ?? '')
  form.set('version', version)
  form.set('status', current.status ?? 'stable')
  form.set('author', current.author ?? '')
  form.set('compatibleWith', current.compatibleWith ?? '')
  form.set('requiresNetwork', current.requiresNetwork ? 'true' : 'false')
  form.set('tags', JSON.stringify(Array.isArray(current.tags) ? current.tags : []))
  form.set('homepage', current.homepage ?? '')
  form.set('pluginFile', new Blob([buf]), path.basename(pluginFile))

  const putRes = await fetchWithCookies(jar, editUrl, { method: 'PUT', body: form })
  const result = await putRes.json().catch(() => ({}))
  if (!putRes.ok) {
    const reason = result && result.error ? result.error : `HTTP ${putRes.status}`
    throw new Error(`העדכון נכשל: ${reason}`)
  }

  const pendingApproval = !!result.pendingApproval
  return {
    published: true,
    skipped: false,
    pendingApproval,
    message: pendingApproval
      ? `העדכון נדחף בהצלחה לגרסה ${version} וממתין לאישור מנהל לפני שיעלה לחנות`
      : `העדכון פורסם בחנות בגרסה ${version}`,
  }
}

module.exports = { publishToStore, CookieJar }
