'use strict'

// בדיקת סחיפה בין העותק המצורף (src/spec.json) למפרט החי שאוצריא מפרסמת.
// המפרט מחולל אצל אוצריא מקוד האפליקציה, ולכן כל הפרש כאן משמעו שהעותק
// המצורף מיושן — והוולידטור לא יכיר API חדש עד ריצת `npm run sync:spec`.
//
// רצה מול הרשת בכוונה, ולכן היא job נפרד ולא חלק מ-npm test.
//
//   node test/specDrift.js                  # דילוג רך כשאין רשת (exit 0)
//   node test/specDrift.js --require-live   # כישלון כשהמפרט החי לא נטען
//
// ההשוואה היא על **המפרט הגולמי** ולא על ה-Sets ש-getApiSpec מחזיר, כי אלה
// משמיטים את settings/baselinePermissions/manifest/versions — דווקא השדות
// שסחיפה בהם בלתי-נראית (כלל blocklist שנעלם מתיר settings.get('…token')).

const { DEFAULT_SPEC_URL, parseSpecJson } = require('../src/apiSpec')
const vendored = require('../src/spec.json')

const FETCH_TIMEOUT_MS = 15000
const requireLive = process.argv.includes('--require-live')

function diff(label, mine, theirs) {
  const missing = [...theirs].filter((x) => !new Set(mine).has(x))
  const extra = [...mine].filter((x) => !new Set(theirs).has(x))
  const lines = []
  if (missing.length) lines.push(`  ${label}: חסרים בעותק המצורף — ${missing.join(', ')}`)
  if (extra.length) lines.push(`  ${label}: קיימים רק בעותק המצורף — ${extra.join(', ')}`)
  return lines
}

// השוואת מפה מפתח-ערך: גם מפתח חסר וגם ערך שהשתנה.
function diffMap(label, mine, theirs) {
  const lines = []
  for (const [key, value] of Object.entries(theirs || {})) {
    const ours = (mine || {})[key]
    if (ours !== value) {
      lines.push(`  ${label}: ${key} — חי=${value} מצורף=${ours ?? 'חסר'}`)
    }
  }
  for (const key of Object.keys(mine || {})) {
    if (!(key in (theirs || {}))) lines.push(`  ${label}: ${key} — קיים רק בעותק המצורף`)
  }
  return lines
}

function diffScalar(label, mine, theirs) {
  return mine === theirs ? [] : [`  ${label}: חי=${theirs} מצורף=${mine}`]
}

// אחזור המפרט החי כ-JSON גולמי. parseSpecJson משמש לאימות צורה בלבד — קובץ
// קטוע או סכימה לא מוכרת נדחים לפני ההשוואה.
async function fetchLiveSpec(url) {
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
    parseSpecJson(text)
    return { spec: JSON.parse(text) }
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const { spec: live, error } = await fetchLiveSpec(DEFAULT_SPEC_URL)

  if (!live) {
    const message = `המפרט החי לא נטען (${error || 'שגיאה לא ידועה'}).`
    if (requireLive) {
      console.error(`✗ ${message} הורץ עם --require-live, ולכן זהו כישלון.`)
      process.exitCode = 1
      return
    }
    // דילוג רך (exit 0) כדי שרשת חסומה לא תשבור ריצה מקומית. ההבחנה מגיעה
    // משני אלה: אזהרה ל-stderr, ו-`--require-live` שה-CI מריץ — כך שריצת CI
    // לא יכולה להיות ירוקה בלי שהשוואה אמיתית התרחשה.
    console.warn(
      `⚠ דילוג: ${message}\n` +
        '  לא בוצעה השוואה כלשהי. להכשלה מפורשת: --require-live.'
    )
    return
  }
  console.log(`המפרט החי נטען מ-${DEFAULT_SPEC_URL}.`)

  const liveSettings = live.settings || {}
  const ourSettings = vendored.settings || {}

  const problems = [
    ...diffScalar('schemaVersion', vendored.schemaVersion, live.schemaVersion),
    ...diff('permissions', vendored.permissions, live.permissions),
    ...diff('baselinePermissions', vendored.baselinePermissions, live.baselinePermissions),
    ...diffMap(
      'legacyPermissionAliases',
      vendored.legacyPermissionAliases,
      live.legacyPermissionAliases
    ),
    ...diff(
      'apiMethods',
      [...vendored.apiMethods, ...vendored.undocumentedApiMethods],
      [...live.apiMethods, ...live.undocumentedApiMethods]
    ),
    ...diff(
      'undocumentedApiMethods',
      vendored.undocumentedApiMethods,
      live.undocumentedApiMethods
    ),
    ...diff('events', vendored.events, live.events),
    ...diffMap('methodMinVersions', vendored.methodMinVersions, live.methodMinVersions),
    ...diffMap('methodPermissions', vendored.methodPermissions, live.methodPermissions),
    // ה-blocklist: כלל שנעלם כאן מתיר בשקט קריאת הגדרה אסורה.
    ...diffScalar('settings.policy', ourSettings.policy, liveSettings.policy),
    ...diff(
      'settings.blockedSubstrings',
      ourSettings.blockedSubstrings || [],
      liveSettings.blockedSubstrings || []
    ),
    ...diff(
      'settings.blockedPrefixes',
      ourSettings.blockedPrefixes || [],
      liveSettings.blockedPrefixes || []
    ),
    ...diff(
      'settings.blockedKeys',
      ourSettings.blockedKeys || [],
      liveSettings.blockedKeys || []
    ),
    ...diff(
      'manifest.stability',
      (vendored.manifest || {}).stability || [],
      (live.manifest || {}).stability || []
    ),
    ...diffMap('versions', vendored.versions, live.versions),
  ]

  // שדה חדש שנוסף למפרט החי ואינו מושווה למעלה — אחרת הרחבת הסכימה נשארת
  // בלתי-נראית עד שמישהו יזכור לעדכן גם את הבדיקה הזו.
  const compared = new Set([
    'schemaVersion', 'generatedBy', 'source', 'permissions', 'baselinePermissions',
    'legacyPermissionAliases', 'apiMethods', 'undocumentedApiMethods', 'events',
    'methodMinVersions', 'methodPermissions', 'settings', 'manifest', 'versions',
  ])
  const unknown = Object.keys(live).filter((k) => !compared.has(k))
  if (unknown.length) {
    problems.push(
      `  שדות חדשים במפרט החי שאינם מושווים כאן — ${unknown.join(', ')} ` +
        '(הוסף אותם ל-test/specDrift.js)'
    )
  }

  if (problems.length > 0) {
    console.error(
      `✗ העותק המצורף src/spec.json סחף מהמפרט החי:\n${problems.join('\n')}\n` +
      'הרץ: npm run sync:spec'
    )
    process.exitCode = 1
    return
  }
  console.log('✓ העותק המצורף זהה למפרט החי בכל שדות המפרט.')
}

main()
