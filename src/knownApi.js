'use strict'

// The Otzaria plugin SDK surface, read from the machine-readable spec that the
// app generates from its own constants (tool/plugins/generate_plugin_spec.dart
// in Otzaria/otzaria → docs/plugin-sdk/spec.json).
//
// The spec is VENDORED at src/spec.json, so the validator behaves identically
// with or without network. `npm run sync:spec` refreshes it and
// `npm run test:spec-drift` fails when it lags behind the app.
//
// Everything below that is NOT in the spec is a validator-local rule and is
// marked as such.

const SPEC = require('./spec.json')

const SUPPORTED_SPEC_SCHEMA = 1
if (SPEC.schemaVersion !== SUPPORTED_SPEC_SCHEMA) {
  throw new Error(
    `src/spec.json schemaVersion ${SPEC.schemaVersion} is not supported ` +
      `(expected ${SUPPORTED_SPEC_SCHEMA}). Update the validator.`
  )
}

const FALLBACK_PERMISSIONS = [...SPEC.permissions]

// Baseline permissions: granted to every plugin automatically. Using their APIs
// without declaring them is not a warning; declaring them only earns a nudge.
const BASELINE_PERMISSIONS = new Set(SPEC.baselinePermissions)

// New permission (key) covered by a legacy declaration (value).
const LEGACY_PERMISSION_ALIASES = { ...SPEC.legacyPermissionAliases }

// VALIDATOR-LOCAL. Minimum Otzaria version in which a declared permission
// exists. An older minAppVersion is a blocking error — old Otzaria rejects
// unknown permissions. The app has no equivalent constant (it only ever sees
// its own version), so this list is maintained here.
const PERMISSION_MIN_VERSION = {
  'fs.folder_access': '0.9.97',
  'plugin.open_other': '0.9.97',
}

// Which Otzaria settings a plugin may read (settings.get, and a `when` leaf of
// kind `setting`). Since 0.9.97 the policy is a BLOCKLIST: everything is
// readable except what the app blocks. Mirrors
// PluginSettingsAccessPolicy.isBlocked — same order, same normalisation.
const SETTINGS_POLICY = SPEC.settings
if (SETTINGS_POLICY.policy !== 'blocklist') {
  throw new Error(`unsupported settings policy "${SETTINGS_POLICY.policy}"`)
}
const BLOCKED_SETTING_KEYS = new Set(SETTINGS_POLICY.blockedKeys)
const BLOCKED_SETTING_PREFIXES = SETTINGS_POLICY.blockedPrefixes
const BLOCKED_SETTING_SUBSTRINGS = SETTINGS_POLICY.blockedSubstrings

function isBlockedSettingKey(key) {
  const normalized = String(key == null ? '' : key).trim().toLowerCase()
  if (normalized === '') return true
  if (BLOCKED_SETTING_KEYS.has(normalized)) return true
  if (BLOCKED_SETTING_PREFIXES.some((p) => normalized.startsWith(p))) return true
  return BLOCKED_SETTING_SUBSTRINGS.some((part) => normalized.includes(part))
}

// contributes.startup `when` conditions exist from this version on.
const WHEN_CONDITION_MIN_VERSION = SPEC.versions.whenCondition

// Headless plugins (manifest `headless: true`) exist from this version on.
const HEADLESS_MIN_VERSION = SPEC.versions.headless

const FALLBACK_API_METHODS = [...SPEC.apiMethods]

// Minimum Otzaria version each API was added in. A plugin that calls an API
// newer than its declared minAppVersion is a blocking error.
const FALLBACK_METHOD_MIN_VERSION = { ...SPEC.methodMinVersions }

const FALLBACK_EVENTS = [...SPEC.events]

// APIs that exist in real plugins but are not documented publicly. The first
// two come from the app's own list; the rest are VALIDATOR-LOCAL, kept so
// plugins in the wild are not warned about them.
const KNOWN_UNDOCUMENTED_METHODS = [
  ...new Set([...SPEC.undocumentedApiMethods, 'network.fetch', 'plugin.uninstall']),
]

// method -> required permission. Used both for "missing permission" warnings
// and as a hint when an invalid permission is declared in the manifest.
const METHOD_REQUIRED_PERMISSION = { ...SPEC.methodPermissions }

// Allowed values of manifest `stability`.
const VALID_STABILITY_VALUES = [...SPEC.manifest.stability]

// Fields on the Otzaria holder object that are not API methods (shorthand scanner).
const RESERVED_HOLDER_FIELDS = new Set([
  'call', 'on', 'off', 'emit', 'once', 'use', 'init', 'setup', 'ready',
])

// Directories never packed into a .otzplugin; an entrypoint inside one breaks silently.
const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', '.idea', '.vscode',
  'node_modules', '__pycache__', '.claude',
])

// Repo-metadata directories that are never part of a plugin (CI config, store
// screenshots). Skipped when packaging, on top of SKIP_DIRS.
const METADATA_DIRS = new Set(['.github', 'screenshots'])

// True for directories that are never plugin assets: the explicit metadata set
// plus any hidden directory (tool artifacts like .gstack, .github, .vscode...).
function isMetadataDir(name) {
  if (name === '.' || name === '..') return false
  return METADATA_DIRS.has(name) || name.startsWith('.')
}

// True for repo-metadata files that are never plugin assets (docs, licenses,
// dotfiles, lockfiles). Skipped when packaging so the .otzplugin stays lean.
function isMetadataFile(relName) {
  const base = relName.split('/').pop()
  if (base.startsWith('.')) return true // .gitignore, .editorconfig, .DS_Store, .eslintrc...
  const lower = base.toLowerCase()
  if (/\.md$/.test(lower)) return true
  if (lower.startsWith('license') || lower.startsWith('licence')) return true
  if (lower === 'package-lock.json' || lower === 'yarn.lock' || lower === 'pnpm-lock.yaml') return true
  return false
}

const TOOL_TAB_ICON_NAME_RE = /^[a-z0-9_]+_24_(regular|filled)$/

// Bare hosts Otzaria accepts in network.allowlist without a scheme.
// Mirrors _loopbackHosts in lib/plugins/models/plugin_network_allowlist.dart.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

module.exports = {
  FALLBACK_PERMISSIONS,
  BASELINE_PERMISSIONS,
  LEGACY_PERMISSION_ALIASES,
  PERMISSION_MIN_VERSION,
  BLOCKED_SETTING_KEYS,
  BLOCKED_SETTING_PREFIXES,
  BLOCKED_SETTING_SUBSTRINGS,
  isBlockedSettingKey,
  WHEN_CONDITION_MIN_VERSION,
  HEADLESS_MIN_VERSION,
  FALLBACK_API_METHODS,
  FALLBACK_METHOD_MIN_VERSION,
  FALLBACK_EVENTS,
  KNOWN_UNDOCUMENTED_METHODS,
  METHOD_REQUIRED_PERMISSION,
  RESERVED_HOLDER_FIELDS,
  SKIP_DIRS,
  METADATA_DIRS,
  isMetadataDir,
  isMetadataFile,
  TOOL_TAB_ICON_NAME_RE,
  LOOPBACK_HOSTS,
  VALID_STABILITY_VALUES,
  SPEC,
}
