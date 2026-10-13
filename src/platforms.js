'use strict'

// ---- פלטפורמות נתמכות -------------------------------------------------------
//
// השדה האופציונלי `platforms` במניפסט מצהיר על מערכות ההפעלה שבהן התוסף עובד:
//
//   "platforms": ["windows", "linux", "macos"]
//
// שדה חסר = "לא הוצהר" (התוסף נחשב מיועד לכל הפלטפורמות). אם הוצהר — מערך
// לא-ריק, בלי כפילויות, של ערכים מתוך PLATFORMS. אלה בדיוק הערכים ש-Dart מחזיר
// ב-Platform.operatingSystem, וש-`app.getInfo` / `plugin.boot` (payload.app.platform)
// מוסרים לתוסף (docs/plugin-sdk/README.md:256).
//
// מעבר לבדיקת הצורה, הוולידטור מסיק פלטפורמות מהקוד: סריקה סטטית של קריאות
// `Otzaria.call('x')` (אותה סריקה של analyzeApiUsage) מול PLATFORM_LIMITED_METHODS
// להלן. זו היוריסטיקה — לעולם אינה חוסמת.

const PLATFORMS = Object.freeze(['windows', 'linux', 'macos', 'android', 'ios'])
const PLATFORM_SET = new Set(PLATFORMS)
const DESKTOP_PLATFORMS = Object.freeze(['windows', 'linux', 'macos'])

// מתודות SDK שאינן זמינות בכל הפלטפורמות. מקור האמת הוא קוד אוצריא — כל רשומה
// מצטטת את המקום (Otzaria/otzaria@dev). `unsupported` = הקריאה נכשלת בשאר
// הפלטפורמות; מתודה שרק מחזירה תוצאה דלה יותר ("degraded") אינה כאן, אלא
// ב-PLATFORM_NOTES, ואינה משנה את הסקת הפלטפורמות.
const PLATFORM_LIMITED_METHODS = Object.freeze({
  // lib/plugins/services/plugin_shortcut_service.dart:53-74 — ענפים ל-Windows/macOS/Linux,
  // ואחרת 'error.unsupported: shortcuts are available on desktop only'.
  // docs/plugin-sdk/API_REFERENCE.md:6119 ("זמין רק בפלטפורמות דסקטופ").
  'shortcut.create': {
    platforms: DESKTOP_PLATFORMS,
    reason: 'קיצורי דרך זמינים בדסקטופ בלבד',
  },
  // lib/plugins/services/plugin_print_service.dart:60-75 — isSupported =
  // Windows||macOS||iOS||Linux, אחרת 'error.unsupported_platform' (כלומר לא באנדרואיד).
  // נקרא מ-ui.print / ui.exportPdf ב-plugin_bridge_adapter.dart:3920-3950,4116-4134.
  'ui.print': {
    platforms: ['windows', 'linux', 'macos', 'ios'],
    reason: 'יצירת PDF מה-WebView אינה נתמכת באנדרואיד',
  },
  'ui.exportPdf': {
    platforms: ['windows', 'linux', 'macos', 'ios'],
    reason: 'יצירת PDF מה-WebView אינה נתמכת באנדרואיד',
  },
})

// מגבלות שאינן "הקריאה נכשלת" — מוצגות כהערה בלבד ואינן משפיעות על ההסקה.
const PLATFORM_NOTES = Object.freeze({
  // lib/plugins/services/plugin_shortcut_service.dart:120-126 ('startMenu is available
  // on Windows only'); API_REFERENCE.md:6128.
  'shortcut.create': "location: 'startMenu' נתמך ב-Windows בלבד",
  // lib/plugins/services/installed_fonts.dart:62-63 — מנייה רק ב-Windows (GDI); בשאר
  // הפלטפורמות families: [] (API_REFERENCE.md:626).
  'fonts.listInstalled': 'מחזיר רשימה ריקה מחוץ ל-Windows',
  // API_REFERENCE.md:2996-2999 — PDF ב-<iframe> מובנה עובד רק ב-Windows/macOS.
  'fs.pickUserFile': 'הצגת PDF ב-<iframe> מובנה עובדת רק ב-Windows/macOS — ב-Linux/Android יש לרנדר עם PDF.js',
})

// קובץ כניסה של תוסף ללא ממשק נטען כמודול (type="module") רק כשהמעטפת מוגשת
// מ-otzaria-plugin:// — macOS, ו-Windows לתוסף headless:
// lib/plugins/services/plugin_asset_scheme.dart:16-21, plugin_headless_shell.dart:19-26,
// docs/plugin-sdk/README.md:710. בשאר הפלטפורמות import סטטי הוא שגיאת תחביר.
const ES_MODULE_PLATFORMS = Object.freeze(['windows', 'macos'])
const ES_IMPORT_RE = /(?:^|[;\n])\s*(?:import\s*(?:[\w*{$][^;\n]*?\bfrom\s*)?['"]|export\s+(?:\*|\{|default\b|const\b|let\b|var\b|function\b|class\b|async\b))/

// בדיקת פלטפורמה בקוד — מכסה את הדפוסים המתועדים: payload.app.platform
// (plugin.boot), app.getInfo, ופונקציות עזר כמו isDesktop()/isMobile().
const PLATFORM_GUARD_RE = /\.\s*platform\b|['"]app\.getInfo['"]|\bapp\s*\.\s*getInfo\b|\bis(?:Desktop|Mobile|Windows|Android|IOS|Ios|Mac|MacOS|Linux)\b/

// ---- Manifest field ---------------------------------------------------------

/**
 * Validate the raw `platforms` manifest value. Missing (`undefined`) is valid.
 * @returns {string[]} Hebrew error messages (blocking)
 */
function validatePlatformsField(raw) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    return [`השדה "platforms" חייב להיות מערך של פלטפורמות (${PLATFORMS.join(', ')})`]
  }
  if (raw.length === 0) {
    return ['השדה "platforms" ריק. השמיטו אותו כדי לציין את כל הפלטפורמות, או פרטו לפחות פלטפורמה אחת']
  }
  const errors = []
  const seen = new Set()
  for (const value of raw) {
    if (typeof value !== 'string' || !PLATFORM_SET.has(value)) {
      errors.push(
        `ערך לא חוקי ב-"platforms": ${JSON.stringify(value)}. ערכים מותרים: ${PLATFORMS.join(', ')}`
      )
      continue
    }
    if (seen.has(value)) {
      errors.push(`הפלטפורמה "${value}" מופיעה פעמיים ב-"platforms"`)
    }
    seen.add(value)
  }
  return errors
}

/**
 * The declared platforms, normalized (known values only, deduped, canonical
 * order), or null when the field is missing / unusable.
 */
function normalizePlatforms(raw) {
  if (!Array.isArray(raw)) return null
  const set = new Set(raw.filter((v) => typeof v === 'string' && PLATFORM_SET.has(v)))
  if (set.size === 0) return null
  return PLATFORMS.filter((p) => set.has(p))
}

// ---- Inference --------------------------------------------------------------

const asText = (value) => (typeof value === 'string' ? value : value.toString('utf8'))

function intersect(a, b) {
  const set = new Set(b)
  return a.filter((p) => set.has(p))
}

/**
 * Infer the platforms a plugin can run on from its code, and cross-check them
 * against the declared `platforms`. Severity-free like analyzeApiUsage: the
 * caller decides what is a warning.
 *
 * @param {object} args
 * @param {object} args.manifest normalized manifest (buildManifest)
 * @param {Map<string,string|Buffer>} args.files relative name -> contents
 * @param {Map<string,Set<string>>} args.apiUsage method -> files (analyzeApiUsage)
 * @param {(text:string)=>string} [args.stripComments] e.g. stripCommentsForScan, so
 *   a guard or an import that only appears in a comment does not count
 */
function analyzePlatforms({ manifest, files, apiUsage, stripComments = (t) => t }) {
  const declared = normalizePlatforms(manifest.platforms)

  const texts = new Map()
  const textOf = (name) => {
    if (!texts.has(name)) {
      const raw = files.get(name)
      let text = ''
      try {
        text = raw == null ? '' : stripComments(asText(raw))
      } catch (_e) { /* unreadable */ }
      texts.set(name, text)
    }
    return texts.get(name)
  }

  // קריאה מוגבלת נחשבת "מוגנת" אם בכל קובץ שבו היא מופיעה יש בדיקת פלטפורמה.
  const limited = []
  for (const [method, info] of Object.entries(PLATFORM_LIMITED_METHODS)) {
    const sources = apiUsage && apiUsage.get(method)
    if (!sources || sources.size === 0) continue
    const sourceList = [...sources]
    const guarded = sourceList.every((name) => PLATFORM_GUARD_RE.test(textOf(name)))
    limited.push({ method, platforms: [...info.platforms], reason: info.reason, sources: sourceList, guarded })
  }

  // מודולי ES בקובץ הכניסה של תוסף ללא ממשק.
  if (manifest.headless && /\.m?js$/i.test(manifest.entrypoint || '') && files.has(manifest.entrypoint)) {
    if (ES_IMPORT_RE.test(textOf(manifest.entrypoint))) {
      limited.push({
        method: 'import/export (ES module)',
        platforms: [...ES_MODULE_PLATFORMS],
        reason: 'קובץ כניסה של תוסף ללא ממשק נטען כמודול רק ב-Windows וב-macOS',
        sources: [manifest.entrypoint],
        guarded: false,
      })
    }
  }

  let inferred = [...PLATFORMS]
  for (const entry of limited) {
    if (!entry.guarded) inferred = intersect(inferred, entry.platforms)
  }

  // הצהרה על פלטפורמה שבה קריאה לא-מוגנת תיכשל.
  const mismatches = []
  if (declared) {
    for (const entry of limited) {
      if (entry.guarded) continue
      const unsupported = declared.filter((p) => !entry.platforms.includes(p))
      if (unsupported.length === 0) continue
      mismatches.push({
        method: entry.method,
        platforms: unsupported,
        message:
          `התוסף מצהיר על ${unsupported.join(', ')} ב-"platforms", אך משתמש ב-${entry.method} ` +
          `שאינו נתמך שם (${entry.reason}; קבצים: ${entry.sources.join(', ')}). ` +
          'הוסיפו בדיקת פלטפורמה (payload.app.platform / app.getInfo) לפני הקריאה, או הסירו את הפלטפורמה מ-"platforms"',
      })
    }
  }

  // תוסף בלי הצהרה שהקוד שלו מוגבל בפועל — המלצה להצהיר.
  let suggestion = null
  if (!declared && inferred.length < PLATFORMS.length) {
    const reasons = limited.filter((e) => !e.guarded).map((e) => e.method)
    suggestion = {
      platforms: inferred,
      message:
        inferred.length === 0
          ? `שילוב הקריאות ${reasons.join(', ')} אינו נתמך באף פלטפורמה ללא בדיקת פלטפורמה — הוסיפו בדיקה (payload.app.platform)`
          : `לפי הקוד (${reasons.join(', ')}) התוסף עובד רק ב-${inferred.join(', ')}. ` +
            `מומלץ להצהיר במניפסט: "platforms": ${JSON.stringify(inferred)}`,
    }
  }

  const notes = []
  for (const [method, note] of Object.entries(PLATFORM_NOTES)) {
    if (apiUsage && apiUsage.has(method)) notes.push({ method, message: `${method}: ${note}` })
  }

  return { declared, inferred, limited, mismatches, suggestion, notes }
}

// תא "פלטפורמות" בטבלת הסיכום: מוצהר מול מוסק. 'כולן' = לא הוגבל.
function formatPlatformsCell(report) {
  if (!report) return '—'
  const list = (arr) => (arr.length === PLATFORMS.length ? 'כולן' : arr.length ? arr.join(', ') : 'אף אחת')
  const declared = report.declared ? list(report.declared) : 'לא הוצהר'
  const inferred = list(report.inferred)
  const flag = report.mismatches.length > 0 ? ' ⚠️' : ''
  return `הוצהר: ${declared} · מוסק: ${inferred}${flag}`
}

module.exports = {
  formatPlatformsCell,
  PLATFORMS,
  DESKTOP_PLATFORMS,
  PLATFORM_LIMITED_METHODS,
  PLATFORM_NOTES,
  ES_MODULE_PLATFORMS,
  validatePlatformsField,
  normalizePlatforms,
  analyzePlatforms,
}
