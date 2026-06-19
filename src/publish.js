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

// Resolve the multipart text fields for the update PUT. Pure (no I/O) so it can
// be unit-tested. The long store description and tags are always preserved.
function resolveUpdateFields({ manifest, current, syncMetadata }) {
  const raw = manifest.raw || {}
  const pick = (manifestVal, currentVal) => {
    const v = (manifestVal == null ? '' : String(manifestVal)).trim()
    return v !== '' ? v : (currentVal == null ? '' : String(currentVal))
  }

  let name, author, shortDescription, status, compatibleWith, homepage, requiresNetwork
  if (syncMetadata) {
    name = pick(manifest.name, current.name)
    author = pick(raw.author, current.author)
    shortDescription = pick(raw.description, current.shortDescription)
    status = pick(raw.stability, current.status) || 'stable'
    compatibleWith = pick(manifest.minAppVersion, current.compatibleWith)
    homepage = pick(raw.homepage, current.homepage)
    requiresNetwork = (raw.network && raw.network.enabled === true) || current.requiresNetwork === true
  } else {
    name = current.name ?? ''
    author = current.author ?? ''
    shortDescription = current.shortDescription ?? ''
    status = current.status ?? 'stable'
    compatibleWith = current.compatibleWith ?? ''
    homepage = current.homepage ?? ''
    requiresNetwork = current.requiresNetwork === true
  }

  return {
    name,
    shortDescription,
    description: current.description ?? '',
    version: manifest.version,
    status,
    author,
    compatibleWith,
    requiresNetwork: requiresNetwork ? 'true' : 'false',
    tags: JSON.stringify(Array.isArray(current.tags) ? current.tags : []),
    homepage,
  }
}

const IMAGE_CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
function imageContentType(file) {
  const ext = path.extname(file).slice(1).toLowerCase()
  return IMAGE_CONTENT_TYPES[ext] || 'application/octet-stream'
}

// A logged-in store session. One login, reused for resolve/edit/upload across
// any number of plugins. Mirrors the browser flow (no token API): CSRF →
// NextAuth credentials login → session cookie. Depends on NextAuth internals.
class StoreClient {
  constructor(baseUrl, log = () => {}) {
    this.base = (baseUrl || 'https://otzaria.org').replace(/\/+$/, '')
    this.jar = new CookieJar()
    this.log = log
    this.user = null
  }

  async login(user, password) {
    const csrfRes = await fetchWithCookies(this.jar, `${this.base}/api/auth/csrf`, {
      headers: { 'User-Agent': 'otzaria-plugin-validator-action' },
    })
    if (!csrfRes.ok) throw new Error(`קבלת CSRF נכשלה: HTTP ${csrfRes.status}`)
    const { csrfToken } = await csrfRes.json()
    if (!csrfToken) throw new Error('לא התקבל csrfToken מהשרת')

    await fetchWithCookies(this.jar, `${this.base}/api/auth/callback/credentials`, {
      method: 'POST',
      body: new URLSearchParams({ csrfToken, identifier: user, password, callbackUrl: `${this.base}/`, json: 'true' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })

    const sessionRes = await fetchWithCookies(this.jar, `${this.base}/api/auth/session`)
    const session = await sessionRes.json().catch(() => ({}))
    if (!session || !session.user) {
      throw new Error('ההתחברות נכשלה: session ריק (בדוק את OTZARIA_USER / OTZARIA_PASSWORD)')
    }
    this.user = session.user
    this.log(`מחובר כ-${session.user.email || session.user.name || 'משתמש'}`)
  }

  // Resolve a manifest id (pluginUid) to the store's _id. Returns
  // { exists, owned, id } — id only when owned by the logged-in user/admin.
  async resolveId(uid) {
    const res = await fetchWithCookies(this.jar, `${this.base}/api/plugins/resolve?uid=${encodeURIComponent(uid)}`)
    if (res.status === 404) return { exists: false } // endpoint missing on older sites
    if (!res.ok) throw new Error(`זיהוי התוסף לפי id נכשל: HTTP ${res.status}`)
    return res.json()
  }

  editUrl(id) {
    return `${this.base}/api/admin/plugins/${encodeURIComponent(id)}/edit`
  }

  // Update an existing plugin (PUT edit). Skips if the store already has the
  // version (unless force). See resolveUpdateFields for the admin-sync logic.
  async edit({ id, pluginFile, manifest, syncMetadata = true, force = false }) {
    const url = this.editUrl(id)
    const currentRes = await fetchWithCookies(this.jar, url)
    if (currentRes.status === 403) throw new Error('אין בעלות על התוסף (403) — החשבון אינו היוצר/מנהל')
    if (currentRes.status === 404) throw new Error(`התוסף ${id} לא נמצא בחנות (404)`)
    if (!currentRes.ok) throw new Error(`שליפת התוסף הנוכחי נכשלה: HTTP ${currentRes.status}`)
    const current = await currentRes.json()
    this.log(`גרסה נוכחית בחנות: ${current.version} ← חדשה: ${manifest.version}`)

    if (!force && current.version === manifest.version) {
      return { published: false, skipped: true, pendingApproval: false, message: `החנות כבר בגרסה ${manifest.version} — דילוג (אפשר לכפות עם force)` }
    }

    const fields = resolveUpdateFields({ manifest, current, syncMetadata })
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.set(k, v)
    form.set('pluginFile', new Blob([fs.readFileSync(pluginFile)]), path.basename(pluginFile))

    const putRes = await fetchWithCookies(this.jar, url, { method: 'PUT', body: form })
    const result = await putRes.json().catch(() => ({}))
    this.log(`תגובת השרת (HTTP ${putRes.status}): ${JSON.stringify(result)}`)
    if (!putRes.ok) throw new Error(`העדכון נכשל: ${result && result.error ? result.error : `HTTP ${putRes.status}`}`)

    const pendingApproval = !!result.pendingApproval
    return {
      published: true,
      skipped: false,
      pendingApproval,
      message: pendingApproval
        ? `העדכון נדחף בהצלחה לגרסה ${manifest.version} וממתין לאישור מנהל לפני שיעלה לחנות`
        : `העדכון פורסם בחנות בגרסה ${manifest.version}`,
    }
  }

  // Create a new plugin (POST upload). The store requires at least one
  // screenshot — provide screenshot file paths.
  async upload({ pluginFile, manifest, description, screenshots = [], tags = [] }) {
    if (!screenshots.length) {
      throw new Error('דחיפה ראשונה (יצירת תוסף חדש) מחייבת לפחות צילום מסך אחד — ספק אותו דרך הקלט screenshots')
    }
    const raw = manifest.raw || {}
    const form = new FormData()
    form.set('pluginFile', new Blob([fs.readFileSync(pluginFile)]), path.basename(pluginFile))
    form.set('description', (description || raw.description || '').toString())
    form.set('tags', JSON.stringify(Array.isArray(tags) ? tags : []))
    for (const shot of screenshots) {
      form.append('screenshots', new Blob([fs.readFileSync(shot)], { type: imageContentType(shot) }), path.basename(shot))
    }

    const res = await fetchWithCookies(this.jar, `${this.base}/api/plugins/upload`, { method: 'POST', body: form })
    const result = await res.json().catch(() => ({}))
    this.log(`תגובת השרת (HTTP ${res.status}): ${JSON.stringify(result)}`)
    if (!res.ok) throw new Error(`יצירת התוסף נכשלה: ${result && result.error ? result.error : `HTTP ${res.status}`}`)

    return {
      published: true,
      created: true,
      skipped: false,
      pendingApproval: true, // a new plugin always awaits approval
      storeId: result.plugin && result.plugin.id ? result.plugin.id : null,
      message: `התוסף נוצר בחנות בגרסה ${manifest.version} וממתין לאישור מנהל`,
    }
  }
}

module.exports = { StoreClient, resolveUpdateFields, imageContentType, CookieJar }
