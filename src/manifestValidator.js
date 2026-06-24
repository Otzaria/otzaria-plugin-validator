'use strict'

const { METHOD_REQUIRED_PERMISSION, TOOL_TAB_ICON_NAME_RE } = require('./knownApi')

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
function buildManifest(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('manifest.json must be a JSON object')
  }
  const network = (json.network && typeof json.network === 'object') ? json.network : {}
  const contributes = (json.contributes && typeof json.contributes === 'object') ? json.contributes : {}
  const toolTab = (contributes.toolTab && typeof contributes.toolTab === 'object') ? contributes.toolTab : {}
  const background = (contributes.background && typeof contributes.background === 'object') ? contributes.background : {}

  const requireString = (value, field) => {
    if (typeof value !== 'string') throw new Error(`השדה "${field}" חסר או אינו מחרוזת`)
    return value
  }

  if (json.schemaVersion !== undefined && !Number.isInteger(json.schemaVersion)) {
    throw new Error('השדה "schemaVersion" חייב להיות מספר שלם')
  }

  const permissions = json.permissions === undefined ? [] : json.permissions
  if (!Array.isArray(permissions)) throw new Error('השדה "permissions" חייב להיות מערך')
  for (const p of permissions) {
    if (typeof p !== 'string') throw new Error('כל הרשאה ב-"permissions" חייבת להיות מחרוזת')
  }

  return {
    schemaVersion: json.schemaVersion === undefined ? 1 : json.schemaVersion,
    id: requireString(json.id, 'id'),
    name: requireString(json.name, 'name'),
    version: requireString(json.version, 'version'),
    entrypoint: requireString(json.entrypoint, 'entrypoint'),
    backgroundEntrypoint: typeof background.entrypoint === 'string' ? background.entrypoint : null,
    minAppVersion: typeof json.minAppVersion === 'string' ? json.minAppVersion : '0.0.0',
    maxAppVersion: typeof json.maxAppVersion === 'string' ? json.maxAppVersion : null,
    permissions,
    networkEnabled: network.enabled === true,
    networkAllowlist: Array.isArray(network.allowlist) ? network.allowlist : [],
    toolTabTitle: typeof toolTab.title === 'string' ? toolTab.title : json.name,
    toolTabIconName: typeof toolTab.iconName === 'string' ? toolTab.iconName : null,
    databaseSources: Array.isArray(contributes.databaseSources) ? contributes.databaseSources : [],
    raw: json,
  }
}

// Blocking structural validation. Port of PluginManifestValidator.validateManifest.
// Collects all errors (instead of throwing on the first) for better CI output;
// pass/fail outcome is identical to the Otzaria packager.
function validateManifestFields({ manifest, validPermissions, appVersion = null, skipAppVersionValidation = true }) {
  const errors = []
  const permissionSet = manifest.permissions

  if (manifest.schemaVersion !== 1) {
    errors.push(`גרסת סכמה ${manifest.schemaVersion} של התוסף אינה נתמכת`)
  }

  if (!/^[a-z0-9_.-]+$/.test(manifest.id)) {
    errors.push('מזהה התוסף אינו תקין')
  }

  if (!/^\d+\.\d+\.\d+(?:\+.*)?$/.test(manifest.version)) {
    errors.push('גרסת התוסף במניפסט אינה חוקית. נדרש פורמט SemVer חוקיות.')
  }

  if (!skipAppVersionValidation) {
    if (appVersion == null) {
      errors.push('יש לספק app-version כאשר בדיקת תאימות גרסה פעילה')
    } else {
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
    }
  }

  for (const perm of permissionSet) {
    if (!validPermissions.has(perm)) {
      const hint = METHOD_REQUIRED_PERMISSION[perm]
      if (hint) {
        errors.push(`הרשאה לא חוקית: "${perm}". האם התכוונת ל-"${hint}"?`)
      } else {
        errors.push(`הרשאה לא חוקית שנדרשת על ידי התוסף: ${perm}`)
      }
    }
  }

  const dbSources = manifest.databaseSources
  if (dbSources.length > 0 && !permissionSet.includes('database.read')) {
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

  if (manifest.toolTabIconName != null && !TOOL_TAB_ICON_NAME_RE.test(manifest.toolTabIconName)) {
    errors.push(
      'toolTab.iconName חייב להיות שם אייקון FluentUI 24px תקין (למשל "book_24_regular" או "calendar_24_filled")'
    )
  }

  return errors
}

module.exports = {
  parseManifestJson,
  buildManifest,
  validateManifestFields,
  compareCoreVersions,
}
