'use strict'

// The SDK surface the validator checks plugins against.
//
// Source of truth: docs/plugin-sdk/spec.json in Otzaria/otzaria, generated from
// the app's own constants by tool/plugins/generate_plugin_spec.dart. A copy is
// VENDORED here at src/spec.json, so the validator has the complete surface
// with no network at all — the outcome never depends on GitHub being reachable.
//
// A live fetch of the same file is still attempted, so an API added after this
// release is accepted. It can only WIDEN the known sets (see mergeWithFallback),
// never narrow them.

const {
  FALLBACK_PERMISSIONS,
  FALLBACK_API_METHODS,
  FALLBACK_METHOD_MIN_VERSION,
  FALLBACK_EVENTS,
  METHOD_REQUIRED_PERMISSION,
} = require('./knownApi')

const DEFAULT_SPEC_URL =
  'https://raw.githubusercontent.com/Otzaria/otzaria/dev/docs/plugin-sdk/spec.json'
const SUPPORTED_SPEC_SCHEMA = 1
const FETCH_TIMEOUT_MS = 15000

function buildFallbackSpec() {
  return {
    permissions: new Set(FALLBACK_PERMISSIONS),
    apiMethods: new Set(FALLBACK_API_METHODS),
    methodMinVersions: new Map(Object.entries(FALLBACK_METHOD_MIN_VERSION)),
    methodPermissions: new Map(Object.entries(METHOD_REQUIRED_PERMISSION)),
    events: new Set(FALLBACK_EVENTS),
    source: 'vendored',
  }
}

// Turn a parsed spec.json into the Sets/Maps the validators consume. Throws on
// a shape it does not recognise, so a truncated or wrong file falls back to the
// vendored copy instead of silently shrinking the known surface.
function parseSpecJson(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || typeof data !== 'object') throw new Error('spec is not an object')
  if (data.schemaVersion !== SUPPORTED_SPEC_SCHEMA) {
    throw new Error(`unsupported schemaVersion ${data.schemaVersion}`)
  }
  const list = (value, field) => {
    if (!Array.isArray(value)) throw new Error(`missing array field "${field}"`)
    return value
  }
  const map = (value, field) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`missing object field "${field}"`)
    }
    return value
  }

  const permissions = list(data.permissions, 'permissions')
  const apiMethods = list(data.apiMethods, 'apiMethods')
  if (permissions.length < 5 || apiMethods.length < 10) {
    throw new Error('spec looked malformed (too few permissions/methods)')
  }

  map(data.settings, 'settings')
  return {
    permissions: new Set(permissions),
    apiMethods: new Set([
      ...apiMethods,
      ...list(data.undocumentedApiMethods, 'undocumentedApiMethods'),
    ]),
    methodMinVersions: new Map(
      Object.entries(map(data.methodMinVersions, 'methodMinVersions'))
    ),
    methodPermissions: new Map(
      Object.entries(map(data.methodPermissions, 'methodPermissions'))
    ),
    events: new Set(list(data.events, 'events')),
    source: 'remote',
  }
}

// Fetch the live spec.json. Any failure returns the vendored copy — which is
// the same artifact, so the known surface is identical either way.
async function getApiSpec(url = DEFAULT_SPEC_URL) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'otzaria-plugin-validator-action' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseSpecJson(await response.text())
  } catch (err) {
    const spec = buildFallbackSpec()
    spec.error = err && err.message ? err.message : String(err)
    return spec
  } finally {
    clearTimeout(timer)
  }
}

// Union the live spec over the vendored floor. The live spec only widens the
// known sets, so a newly-added API is accepted while a lagging spec never
// rejects something the app already considers valid.
function mergeWithFallback(spec) {
  // Versions: start from the vendored floor, then let the live spec override —
  // both are generated from the same code, so this only picks up new APIs.
  const methodMinVersions = new Map(Object.entries(FALLBACK_METHOD_MIN_VERSION))
  if (spec.methodMinVersions) {
    for (const [method, version] of spec.methodMinVersions) {
      methodMinVersions.set(method, version)
    }
  }
  // Permissions: additive only. A permission that was split (ui.pickFolder →
  // fs.folder_access) is already in the vendored map; letting a lagging spec
  // override would walk the warning back to the older permission.
  const methodPermissions = new Map(Object.entries(METHOD_REQUIRED_PERMISSION))
  if (spec.methodPermissions) {
    for (const [method, permission] of spec.methodPermissions) {
      if (!methodPermissions.has(method)) methodPermissions.set(method, permission)
    }
  }
  return {
    permissions: new Set([...FALLBACK_PERMISSIONS, ...spec.permissions]),
    apiMethods: new Set([...FALLBACK_API_METHODS, ...spec.apiMethods]),
    methodMinVersions,
    methodPermissions,
    events: new Set([...FALLBACK_EVENTS, ...spec.events]),
    source: spec.source,
    error: spec.error,
  }
}

module.exports = {
  DEFAULT_SPEC_URL,
  SUPPORTED_SPEC_SCHEMA,
  getApiSpec,
  mergeWithFallback,
  buildFallbackSpec,
  parseSpecJson,
}
