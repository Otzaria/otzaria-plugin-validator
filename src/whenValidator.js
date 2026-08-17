'use strict'

// Validation of the `when` condition on contributes.startup contributions.
// Port of PluginWhenCondition.fromJson + PluginExtendedValidator
// ._validateWhenConditions, including the activationEvents object form.

const {
  FALLBACK_SETTING_READ_KEYS,
  BLOCKED_SETTING_KEYS,
  WHEN_CONDITION_MIN_VERSION,
} = require('./knownApi')
const { compareCoreVersions } = require('./manifestValidator')

const MAX_DEPTH = 5
const MAX_LEAVES = 20
const MAX_KEY_LENGTH = 128

const LEAF_OPERATORS = ['equals', 'notEquals', 'exists']

class WhenConditionError extends Error {}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// Parse one node, collecting the `setting` keys it reads. Throws
// WhenConditionError on any schema or limit violation.
function parseNode(node, { depth, counter, settingKeys }) {
  if (depth > MAX_DEPTH) throw new WhenConditionError('when is nested too deeply')
  if (!isPlainObject(node)) throw new WhenConditionError('when must be an object')

  const fields = Object.keys(node)
  if (fields.length !== 1) {
    throw new WhenConditionError(
      'when must declare exactly one of setting, storage, all, any, not'
    )
  }
  const field = fields[0]
  const value = node[field]

  switch (field) {
    case 'setting':
    case 'storage': {
      const key = parseLeaf(value, counter)
      if (field === 'setting') settingKeys.add(key)
      return
    }
    case 'all':
    case 'any': {
      if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LEAVES) {
        throw new WhenConditionError(`${field} must be a non-empty array of conditions`)
      }
      for (const child of value) {
        parseNode(child, { depth: depth + 1, counter, settingKeys })
      }
      return
    }
    case 'not':
      parseNode(value, { depth: depth + 1, counter, settingKeys })
      return
    default:
      throw new WhenConditionError(`unsupported when operator "${field}"`)
  }
}

function parseLeaf(raw, counter) {
  counter.count++
  if (counter.count > MAX_LEAVES) {
    throw new WhenConditionError('when has too many conditions')
  }
  if (!isPlainObject(raw)) {
    throw new WhenConditionError('when leaf must be an object with a key')
  }
  const key = raw.key
  if (typeof key !== 'string' || key === '' || key.length > MAX_KEY_LENGTH) {
    throw new WhenConditionError(
      'when leaf key must be a non-empty string of up to 128 characters'
    )
  }
  const unknown = Object.keys(raw).find(
    (field) => field !== 'key' && !LEAF_OPERATORS.includes(field)
  )
  if (unknown) throw new WhenConditionError(`unsupported when field "${unknown}"`)

  const declared = LEAF_OPERATORS.filter((op) =>
    Object.prototype.hasOwnProperty.call(raw, op)
  )
  if (declared.length !== 1) {
    throw new WhenConditionError(
      'when leaf requires exactly one of equals, notEquals, exists'
    )
  }
  const operator = declared[0]
  const compared = raw[operator]
  if (operator === 'exists') {
    if (typeof compared !== 'boolean') {
      throw new WhenConditionError('when exists must be a bool')
    }
  } else if (
    compared !== null &&
    typeof compared !== 'string' &&
    typeof compared !== 'number' &&
    typeof compared !== 'boolean'
  ) {
    throw new WhenConditionError('when comparison value must be a string, number or bool')
  }
  return key
}

/**
 * Blocking validation of every `when` in contributes.startup. A plugin with no
 * `when` (and no object-form activationEvents) is untouched.
 *
 * @param {object} args
 * @param {object} args.manifest normalized manifest (raw JSON under .raw)
 * @param {{settingKeys?:Set<string>}} [args.spec] merged API spec
 * @returns {string[]} blocking errors
 */
function validateWhenConditions({ manifest, spec }) {
  const errors = []
  const raw = manifest && manifest.raw
  const contributes = raw && isPlainObject(raw.contributes) ? raw.contributes : null
  const startup = contributes && isPlainObject(contributes.startup) ? contributes.startup : null
  if (!startup) return errors

  const readableKeys =
    (spec && spec.settingKeys) || new Set(FALLBACK_SETTING_READ_KEYS)
  let hasWhen = false

  const validateRaw = (field, when) => {
    if (when === undefined || when === null) return
    hasWhen = true
    const settingKeys = new Set()
    try {
      parseNode(when, { depth: 1, counter: { count: 0 }, settingKeys })
    } catch (e) {
      if (!(e instanceof WhenConditionError)) throw e
      errors.push(`contributes.startup.${field}: when לא תקין: ${e.message}`)
      return
    }
    for (const key of settingKeys) {
      if (readableKeys.has(key) && !BLOCKED_SETTING_KEYS.has(key)) continue
      errors.push(
        `contributes.startup.${field}: when קורא הגדרה שאינה זמינה לתוספים ("${key}")`
      )
    }
  }

  for (const field of ['toolbarItems', 'contextMenuItems', 'searchDialogItems']) {
    const items = startup[field]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (isPlainObject(item)) validateRaw(field, item.when)
    }
  }

  const events = startup.activationEvents
  if (Array.isArray(events)) {
    for (const entry of events) {
      if (!isPlainObject(entry)) continue
      // A typo like "wen" must fail installation instead of silently dropping
      // the condition, so unknown keys are rejected.
      const unknown = Object.keys(entry).find((key) => key !== 'topic' && key !== 'when')
      if (unknown) {
        errors.push(
          `contributes.startup.activationEvents: שדה לא מוכר "${unknown}" ` +
          '(מותרים topic ו-when בלבד)'
        )
      }
      if (typeof entry.topic !== 'string') {
        errors.push(
          'contributes.startup.activationEvents מכיל ערך שאינו מחרוזת או אובייקט עם topic'
        )
      }
      validateRaw('activationEvents', entry.when)
    }
  }

  if (!hasWhen) return errors
  try {
    if (compareCoreVersions(WHEN_CONDITION_MIN_VERSION, manifest.minAppVersion) > 0) {
      errors.push(
        `תנאי when נתמך החל מגרסה ${WHEN_CONDITION_MIN_VERSION}, אך minAppVersion ` +
        `שהוצהר הוא ${manifest.minAppVersion}`
      )
    }
  } catch (_e) {
    // invalid minAppVersion format — reported by validateManifestFields
  }
  return errors
}

module.exports = { validateWhenConditions }
