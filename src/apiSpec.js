'use strict'

const {
  FALLBACK_PERMISSIONS,
  FALLBACK_API_METHODS,
  FALLBACK_METHOD_MIN_VERSION,
  FALLBACK_EVENTS,
} = require('./knownApi')

const DEFAULT_API_REFERENCE_URL =
  'https://raw.githubusercontent.com/Otzaria/otzaria/dev/docs/plugin-sdk/API_REFERENCE.md'
const FETCH_TIMEOUT_MS = 15000

function buildFallbackSpec() {
  return {
    permissions: new Set(FALLBACK_PERMISSIONS),
    apiMethods: new Set(FALLBACK_API_METHODS),
    methodMinVersions: new Map(Object.entries(FALLBACK_METHOD_MIN_VERSION)),
    events: new Set(FALLBACK_EVENTS),
    source: 'fallback',
  }
}

// Permissions are dotted snake_case, no camelCase. e.g. library.books.read.
function looksLikePermission(token) {
  if (token.startsWith('events.subscribe:')) {
    const tail = token.slice('events.subscribe:'.length)
    return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(tail)
  }
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(token)) return false
  if (/[A-Z]/.test(token)) return false
  if (/^(event|namespace|plugin)\.(name|method|id)$/.test(token)) return false
  return true
}

// Parse the official API_REFERENCE.md into permissions / apiMethods / events.
// Mirrors parseApiReferenceMarkdown in the website validator.
function parseApiReferenceMarkdown(md) {
  const permissions = new Set()
  const apiMethods = new Set()
  const events = new Set()

  let match
  const subRe = /events\.subscribe:[a-z][a-zA-Z0-9_.]+/g
  while ((match = subRe.exec(md)) !== null) permissions.add(match[0])

  const inlineRe = /`([a-z][a-zA-Z0-9_.:]+)`/g
  while ((match = inlineRe.exec(md)) !== null) {
    if (looksLikePermission(match[1])) permissions.add(match[1])
  }

  const headingRe = /^###\s+`([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+)`/gm
  while ((match = headingRe.exec(md)) !== null) apiMethods.add(match[1])
  const callRe = /Otzaria\.call\(['"]([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+)['"]/g
  while ((match = callRe.exec(md)) !== null) {
    if (match[1] === 'namespace.method') continue
    apiMethods.add(match[1])
  }

  // "טבלת גרסאות API": rows like ``| `namespace.method` | 0.9.89 |``.
  const methodMinVersions = new Map()
  const versionRowRe =
    /^\|\s*`([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+)`\s*\|\s*(\d+\.\d+\.\d+)\s*\|/gm
  while ((match = versionRowRe.exec(md)) !== null) {
    methodMinVersions.set(match[1], match[2])
  }

  const onRe = /Otzaria\.on\(['"]([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+)['"]/g
  while ((match = onRe.exec(md)) !== null) {
    if (match[1] === 'event.name') continue
    events.add(match[1])
  }
  for (const perm of permissions) {
    if (perm.startsWith('events.subscribe:')) {
      events.add(perm.slice('events.subscribe:'.length))
    }
  }
  for (const lifecycle of ['plugin.boot', 'plugin.ready']) {
    if (md.includes(lifecycle)) events.add(lifecycle)
  }

  if (permissions.size < 5 || apiMethods.size < 10) {
    throw new Error('Parsed API reference looked malformed')
  }

  return {
    permissions,
    apiMethods,
    methodMinVersions,
    events: events.size > 0 ? events : new Set(FALLBACK_EVENTS),
    source: 'remote',
  }
}

// Fetch + parse the live spec from GitHub. Falls back to the hardcoded
// snapshot on any failure so CI never breaks because GitHub is unreachable.
async function getApiSpec(url = DEFAULT_API_REFERENCE_URL) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'otzaria-plugin-validator-action' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    return parseApiReferenceMarkdown(text)
  } catch (err) {
    const spec = buildFallbackSpec()
    spec.error = err && err.message ? err.message : String(err)
    return spec
  } finally {
    clearTimeout(timer)
  }
}

// Union the live spec over the hardcoded floor. The live doc only widens the
// known sets, so a newly-added API is accepted while a lagging doc never
// rejects something the app already considers valid.
function mergeWithFallback(spec) {
  // Versions: start from the hardcoded floor, then let the live doc override —
  // the doc is the source of truth, but a missing/unparsed row keeps the floor.
  const methodMinVersions = new Map(Object.entries(FALLBACK_METHOD_MIN_VERSION))
  if (spec.methodMinVersions) {
    for (const [method, version] of spec.methodMinVersions) {
      methodMinVersions.set(method, version)
    }
  }
  return {
    permissions: new Set([...FALLBACK_PERMISSIONS, ...spec.permissions]),
    apiMethods: new Set([...FALLBACK_API_METHODS, ...spec.apiMethods]),
    methodMinVersions,
    events: new Set([...FALLBACK_EVENTS, ...spec.events]),
    source: spec.source,
    error: spec.error,
  }
}

module.exports = {
  DEFAULT_API_REFERENCE_URL,
  getApiSpec,
  mergeWithFallback,
  buildFallbackSpec,
  parseApiReferenceMarkdown,
  looksLikePermission,
}
