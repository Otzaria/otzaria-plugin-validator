'use strict'

// Validation of headless plugins (`"headless": true`) — a manifest plus a JS
// entrypoint that runs only in the background engine, with no tab of its own.
// Port of PluginExtendedValidator._validateHeadless and
// PluginStartupContributions.hasBackgroundActivationTrigger.

const { HEADLESS_MIN_VERSION } = require('./knownApi')
const { compareCoreVersions } = require('./manifestValidator')

const RUN_ON_STARTUP_PERMISSION = 'app.run_on_startup'

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

function toolbarItemActivatesBackground(item) {
  if (has(item, 'binding') || has(item, 'action') || has(item, 'childrenBinding')) {
    return false
  }
  if (item.type === 'menu' || item.type === 'split') {
    const childActivates =
      Array.isArray(item.children) &&
      item.children.some((child) => isPlainObject(child) && toolbarItemActivatesBackground(child))
    // בלחצן מפוצל גם הפעולה הראשית עצמה מגיעה למנוע התוסף.
    return childActivates || (item.type === 'split' && item.openPlugin !== true)
  }
  return item.openPlugin !== true
}

function contextMenuItemActivatesBackground(item) {
  switch (item.type) {
    case 'separator':
      return false
    case 'submenu':
      return (
        Array.isArray(item.children) &&
        item.children.some((child) => isPlainObject(child) && contextMenuItemActivatesBackground(child))
      )
    case 'color-row':
      return true
    default:
      if (has(item, 'action')) return false
      return item.openPlugin !== true
  }
}

function hasActivationEvent(events) {
  if (!Array.isArray(events)) return false
  return events.some((entry) => {
    if (typeof entry === 'string') return true
    if (!isPlainObject(entry)) return false
    if (Object.keys(entry).some((key) => key !== 'topic' && key !== 'when')) return false
    return typeof entry.topic === 'string' && entry.topic !== ''
  })
}

/** האם קיימת פעולה שבאמת עשויה להרים את מנוע הרקע. */
function hasBackgroundActivationTrigger(startup) {
  if (!isPlainObject(startup)) return false
  const items = (field) => (Array.isArray(startup[field]) ? startup[field].filter(isPlainObject) : [])
  return (
    hasActivationEvent(startup.activationEvents) ||
    items('toolbarItems').some(toolbarItemActivatesBackground) ||
    items('contextMenuItems').some(contextMenuItemActivatesBackground)
  )
}

function containsTrueKey(node, keys) {
  if (Array.isArray(node)) return node.some((child) => containsTrueKey(child, keys))
  if (!isPlainObject(node)) return false
  return Object.entries(node).some(
    ([key, value]) => (keys.has(key) && value === true) || containsTrueKey(value, keys)
  )
}

/**
 * Blocking validation of a headless plugin. A plugin without `headless` is
 * untouched.
 *
 * @param {object} args
 * @param {object} args.manifest normalized manifest (raw JSON under .raw)
 * @returns {string[]} blocking errors
 */
function validateHeadless({ manifest }) {
  const errors = []
  const raw = (manifest && manifest.raw) || {}
  if (raw.headless !== undefined && raw.headless !== null && typeof raw.headless !== 'boolean') {
    errors.push('השדה headless חייב להיות true או false')
    return errors
  }
  if (raw.headless !== true) return errors

  try {
    if (compareCoreVersions(HEADLESS_MIN_VERSION, manifest.minAppVersion) > 0) {
      errors.push(
        `תוסף ללא ממשק (headless) נתמך החל מגרסה ${HEADLESS_MIN_VERSION}, אך ` +
          `minAppVersion שהוצהר הוא ${manifest.minAppVersion}. עדכן את minAppVersion`
      )
    }
  } catch (_e) {
    // minAppVersion לא חוקי — מדווח בכללי המניפסט.
  }

  const contributes = isPlainObject(raw.contributes) ? raw.contributes : {}
  if (!hasBackgroundActivationTrigger(contributes.startup)) {
    errors.push(
      'לתוסף ללא ממשק (headless) אין שום דרך לפעול: יש להצהיר ב-' +
        'contributes.startup על activationEvents, או על פקד או פריט תפריט ' +
        'שמפעילים את התוסף'
    )
  }
  if (!manifest.permissions.includes(RUN_ON_STARTUP_PERMISSION)) {
    errors.push(
      'תוסף ללא ממשק (headless) חייב לבקש את ההרשאה ' +
        `"${RUN_ON_STARTUP_PERMISSION}" — בלעדיה המנוע שלו לעולם לא מתעורר`
    )
  }
  if (contributes.toolTab !== undefined && contributes.toolTab !== null) {
    errors.push('תוסף ללא ממשק (headless) אינו מוצג ככרטיסייה — הסירו את contributes.toolTab')
  }
  if (containsTrueKey(contributes.startup, new Set(['openPlugin', 'openPluginOnSubmit']))) {
    errors.push(
      'תוסף ללא ממשק (headless) אינו יכול להשתמש ב-openPlugin או ' +
        'ב-openPluginOnSubmit — אין לו דף לפתוח'
    )
  }
  return errors
}

module.exports = { validateHeadless, hasBackgroundActivationTrigger }
