'use strict'

const {
  METHOD_REQUIRED_PERMISSION,
  FALLBACK_API_METHODS,
  TOOL_TAB_ICON_NAME_RE,
} = require('./knownApi')

// Methods whose boundary is enforced outside the manifest (a user dialog, a
// chosen folder, the plugin's private root) carry no entry in methodPermissions.
const FALLBACK_API_METHOD_SET = new Set(FALLBACK_API_METHODS)

// דרגות היציבות המותרות בשדה stability (נגזר ל-status בחנות).
const VALID_STABILITY_VALUES = new Set(['stable', 'beta', 'experimental'])

// Compare two versions by their core major.minor.patch, ignoring build/prerelease.
// Port of PluginVersionUtils.compareCoreVersions.
function parseCoreSegments(version) {
  const sanitized = String(version).split('+')[0].split('-')[0].trim()
  if (sanitized === '') throw new Error(`פורמט גרסה לא חוקי: ${version}`)
  return sanitized.split('.').map((seg) => {
    const n = Number(seg)
    if (!Number.isInteger(n)) throw new Error(`פורמט גרסה לא חוקי: ${version}`)
    return n
  })
}

function compareCoreVersions(first, second) {
  const a = parseCoreSegments(first)
  const b = parseCoreSegments(second)
  for (let i = 0; i < 3; i++) {
    const x = i < a.length ? a[i] : 0
    const y = i < b.length ? b[i] : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

// Parse manifest JSON, stripping a leading BOM that Windows editors add.
function parseManifestJson(text) {
  return JSON.parse(text.replace(/^﻿/, ''))
}

// Build the normalized manifest, throwing on missing/mistyped required fields.
// Mirrors PluginManifest.fromJson (id/name/version/entrypoint are required).
//
// `lenient` turns those throws into defaults, for a consumer (the store) that
// scores a manifest rule by rule rather than rejecting it outright. What the
// author actually declared is recorded on `.declared`, so a rule can skip a
// field that was never written.
function buildManifest(json, { lenient = false } = {}) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    if (!lenient) throw new Error('manifest.json must be a JSON object')
    json = {}
  }
  const network = (json.network && typeof json.network === 'object') ? json.network : {}
  const contributes = (json.contributes && typeof json.contributes === 'object') ? json.contributes : {}
  const toolTab = (contributes.toolTab && typeof contributes.toolTab === 'object') ? contributes.toolTab : {}
  const background = (contributes.background && typeof contributes.background === 'object') ? contributes.background : {}

  const requireString = (value, field) => {
    if (typeof value === 'string') return value
    if (lenient) return ''
    throw new Error(`השדה "${field}" חסר או אינו מחרוזת`)
  }

  if (json.schemaVersion !== undefined && !Number.isInteger(json.schemaVersion) && !lenient) {
    throw new Error('השדה "schemaVersion" חייב להיות מספר שלם')
  }

  let permissions = json.permissions === undefined ? [] : json.permissions
  if (!Array.isArray(permissions)) {
    if (!lenient) throw new Error('השדה "permissions" חייב להיות מערך')
    permissions = []
  }
  for (const p of permissions) {
    if (typeof p !== 'string' && !lenient) {
      throw new Error('כל הרשאה ב-"permissions" חייבת להיות מחרוזת')
    }
  }
  if (lenient) permissions = permissions.filter((p) => typeof p === 'string')

  return {
    // מה הוצהר בפועל — כדי שכלל ידלג על שדה שהמחבר לא כתב כלל (מצב lenient).
    declared: {
      name: typeof json.name === 'string',
      toolTabTitle: typeof toolTab.title === 'string',
      permissions: Array.isArray(json.permissions),
    },
    schemaVersion: json.schemaVersion === undefined ? 1 : json.schemaVersion,
    id: requireString(json.id, 'id'),
    name: requireString(json.name, 'name'),
    description: typeof json.description === 'string' ? json.description : '',
    version: requireString(json.version, 'version'),
    entrypoint: requireString(json.entrypoint, 'entrypoint'),
    backgroundEntrypoint: typeof background.entrypoint === 'string' ? background.entrypoint : null,
    headless: json.headless === true,
    stability: typeof json.stability === 'string' ? json.stability : 'stable',
    minAppVersion: typeof json.minAppVersion === 'string' ? json.minAppVersion : '0.0.0',
    maxAppVersion: typeof json.maxAppVersion === 'string' ? json.maxAppVersion : null,
    permissions,
    networkEnabled: network.enabled === true,
    networkAllowlist: Array.isArray(network.allowlist) ? network.allowlist : [],
    toolTabTitle: typeof toolTab.title === 'string'
      ? toolTab.title
      : (typeof json.name === 'string' ? json.name : ''),
    toolTabIconName: typeof toolTab.iconName === 'string' ? toolTab.iconName : null,
    databaseSources: Array.isArray(contributes.databaseSources) ? contributes.databaseSources : [],
    raw: json,
  }
}

// The blocking manifest rules, one function per rule. Split so a consumer can
// run a subset — this Action and the Otzaria packager run all of them, the
// store gates on fewer (see README, "מי אחראי על מה").
// Port of PluginManifestValidator.validateManifest.
const MANIFEST_RULES = {
  schemaVersion({ manifest, errors }) {
    if (manifest.schemaVersion !== 1) {
      errors.push(`גרסת סכמה ${manifest.schemaVersion} של התוסף אינה נתמכת`)
    }
  },

  id({ manifest, errors }) {
    if (!/^[a-z0-9_.-]+$/.test(manifest.id)) {
      errors.push('מזהה התוסף אינו תקין')
    }
  },

  // שם התוסף מוצג בראש לשונית התוסף ב"כלים" — מעבר ל-14 תווים גולש מהכרטיסייה.
  name({ manifest, errors }) {
    if (manifest.name.trim().length > 14) {
      errors.push('שם התוסף חייב להכיל לכל היותר 14 תווים')
    }
  },

  // description הוא התיאור הקצר שמוצג בכרטיס התוסף בחנות — מוגבל ל-150 תווים.
  description({ manifest, errors }) {
    if (manifest.description.trim().length > 150) {
      errors.push('תיאור קצר חייב להכיל לכל היותר 150 תווים')
    }
  },

  // הכותרת המוצגת בטאב חייבת להיות זהה ל-name (גם כותרת ריקה נחסמת — היא
  // תציג טאב בלי טקסט). title חסר נופל ל-name ב-buildManifest ולכן עובר.
  toolTabTitle({ manifest, errors }) {
    if (manifest.declared && manifest.declared.name === false) return
    if (manifest.toolTabTitle.trim() !== manifest.name.trim()) {
      errors.push(
        `שם התוסף ("${manifest.name}") שונה מכותרת הטאב ב-contributes.toolTab.title ("${manifest.toolTabTitle}"). השמות חייבים להיות זהים`
      )
    }
  },

  version({ manifest, errors }) {
    if (!/^\d+\.\d+\.\d+(?:\+.*)?$/.test(manifest.version)) {
      errors.push('גרסת התוסף במניפסט אינה חוקית. נדרש פורמט SemVer חוקיות.')
    }
  },

  // stability נגזר ל-status בחנות — חייב להיות אחד מהערכים המותרים.
  stability({ manifest, errors }) {
    if (!VALID_STABILITY_VALUES.has(manifest.stability)) {
      errors.push(
        `שדה stability אינו תקין ("${manifest.stability}"). ערכים מותרים: ${[...VALID_STABILITY_VALUES].join(', ')}`
      )
    }
  },

  appVersionRange({ manifest, errors, appVersion, skipAppVersionValidation }) {
    if (skipAppVersionValidation) return
    if (appVersion == null) {
      errors.push('יש לספק app-version כאשר בדיקת תאימות גרסה פעילה')
      return
    }
    try {
      if (compareCoreVersions(appVersion, manifest.minAppVersion) < 0) {
        errors.push(`התוסף דורש אוצריא בגרסה ${manifest.minAppVersion} לפחות, אך מותקנת ${appVersion}`)
      }
      if (manifest.maxAppVersion != null && compareCoreVersions(appVersion, manifest.maxAppVersion) > 0) {
        errors.push(`התוסף מיועד לאוצריא עד גרסה ${manifest.maxAppVersion} בלבד, אך מותקנת ${appVersion}`)
      }
    } catch (e) {
      errors.push(e.message)
    }
  },

  permissions({ manifest, errors, validPermissions, methodPermissions, apiMethods }) {
    const known = apiMethods || FALLBACK_API_METHOD_SET
    for (const perm of manifest.permissions) {
      if (validPermissions.has(perm)) continue
      const hint =
        (methodPermissions && methodPermissions.get(perm)) ||
        METHOD_REQUIRED_PERMISSION[perm]
      if (hint) {
        errors.push(`הרשאה לא חוקית: "${perm}". האם התכוונת ל-"${hint}"?`)
      } else if (known.has(perm)) {
        errors.push(
          `"${perm}" היא קריאת API ולא שם של הרשאה, והיא אינה דורשת הרשאה ` +
            `במניפסט. הסירו אותה מ-permissions — הקריאה עצמה תמשיך לעבוד`,
        )
      } else {
        errors.push(`הרשאה לא חוקית שנדרשת על ידי התוסף: ${perm}`)
      }
    }
  },

  databaseSources({ manifest, errors }) {
    const dbSources = manifest.databaseSources
    if (dbSources.length > 0 && !manifest.permissions.includes('database.read')) {
      errors.push('התוסף מצהיר על contributes.databaseSources אך לא מבקש את ההרשאה database.read')
    }
    for (const source of dbSources) {
      const id = source && source.id
      const label = source && source.label
      const required = source && source.required
      if (typeof id !== 'string' || id === '') {
        errors.push('כל ערך ב-contributes.databaseSources חייב לכלול id מסוג string')
        continue
      }
      if (!/^[a-z0-9_.-]+$/.test(id)) {
        errors.push(`מזהה מקור מסד נתונים אינו תקין: "${id}"`)
      }
      if (label !== undefined && label !== null && typeof label !== 'string') {
        errors.push('השדה label ב-contributes.databaseSources חייב להיות string')
      }
      if (required !== undefined && required !== null && typeof required !== 'boolean') {
        errors.push('השדה required ב-contributes.databaseSources חייב להיות bool')
      }
    }
  },

  // תוסף ללא ממשק רץ כסקריפט בתוך מעטפת שאוצריא מייצרת — אין לו HTML משלו.
  headless({ manifest, errors }) {
    if (!manifest.headless) return
    if (!/\.js$/i.test(manifest.entrypoint)) {
      errors.push(
        `בתוסף ללא ממשק (headless) קובץ הכניסה חייב להיות קובץ JS, ולא "${manifest.entrypoint}"`
      )
    }
    if (manifest.backgroundEntrypoint != null) {
      errors.push(
        'תוסף ללא ממשק (headless) אינו יכול להצהיר על contributes.background.entrypoint — קובץ הכניסה עצמו רץ ברקע'
      )
    }
  },

  toolTabIcon({ manifest, errors }) {
    if (manifest.toolTabIconName != null && !TOOL_TAB_ICON_NAME_RE.test(manifest.toolTabIconName)) {
      errors.push(
        'toolTab.iconName חייב להיות שם אייקון FluentUI 24px תקין (למשל "book_24_regular" או "calendar_24_filled")'
      )
    }
  },
}

// סדר הכללים הוא סדר ההודעות — לשמור אותו יציב.
const ALL_MANIFEST_RULES = Object.keys(MANIFEST_RULES)

// Blocking structural validation. Collects all errors (instead of throwing on
// the first) for better CI output; pass/fail outcome is identical to the
// Otzaria packager. `rules` selects which of MANIFEST_RULES to run.
function validateManifestFields({
  manifest,
  validPermissions,
  methodPermissions = null,
  apiMethods = null,
  appVersion = null,
  skipAppVersionValidation = true,
  rules = ALL_MANIFEST_RULES,
}) {
  const errors = []
  const ctx = {
    manifest,
    errors,
    validPermissions,
    methodPermissions,
    apiMethods,
    appVersion,
    skipAppVersionValidation,
  }
  for (const name of rules) {
    const rule = MANIFEST_RULES[name]
    if (!rule) throw new Error(`unknown manifest rule "${name}"`)
    rule(ctx)
  }
  return errors
}

module.exports = {
  parseManifestJson,
  buildManifest,
  validateManifestFields,
  compareCoreVersions,
  MANIFEST_RULES,
  ALL_MANIFEST_RULES,
  VALID_STABILITY_VALUES,
}
