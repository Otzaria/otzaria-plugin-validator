'use strict'

const {
  KNOWN_UNDOCUMENTED_METHODS,
  METHOD_REQUIRED_PERMISSION,
  RESERVED_HOLDER_FIELDS,
} = require('./knownApi')

const CODE_FILE_RE = /\.(?:js|mjs|cjs|html?|vue|svelte)$/i
const STYLE_FILE_RE = /\.(?:css|html?)$/i

const isCodeLikeFile = (name) => CODE_FILE_RE.test(name)
const isStyleLikeFile = (name) => STYLE_FILE_RE.test(name)

// ---- Code scanning ----------------------------------------------------------

const CALL_RE = /Otzaria\s*\.\s*call\s*\(\s*['"]([a-zA-Z][\w.]*)['"]/g
const ON_RE = /Otzaria\s*\.\s*on\s*\(\s*['"]([a-zA-Z][\w.]*)['"]/g
const OFF_RE = /Otzaria\s*\.\s*off\s*\(\s*['"]([a-zA-Z][\w.]*)['"]/g
const SHORTHAND_RE = /Otzaria\s*\.\s*([a-z][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g

// Strip comments before scanning so that example calls inside JSDoc/SDK shims
// are not counted. String and regex literals are placeholdered first so that
// '//' inside a URL or regex does not chop a real call after it.
// Port of PluginExtendedValidator._stripCommentsForScan.
function stripCommentsForScan(text) {
  let stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const placeholders = []
  const stash = (m) => {
    const idx = placeholders.length
    placeholders.push(m)
    return ` STR${idx} `
  }

  stripped = stripped.replace(
    /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g,
    (m) => stash(m)
  )

  stripped = stripped.replace(
    /(^|[=(,;:!?~&|+\-*/%<>{}[\]]|=>|\breturn\b|\bthrow\b|\bin\b|\bof\b|\btypeof\b|\bdelete\b|\bvoid\b|\binstanceof\b|\bnew\b)(\s*)(\/(?:\\.|\[(?:\\.|[^\]\\\n\r])*\]|[^/\\\n\r])+?\/[gimsuyd]*)/g,
    (_m, ctx, ws, re) => {
      const idx = placeholders.length
      placeholders.push(re)
      return `${ctx}${ws} STR${idx} `
    }
  )

  stripped = stripped.replace(/\/\/[^\n\r]*/g, '')
  stripped = stripped.replace(/ STR(\d+) /g, (_m, n) => placeholders[Number(n)])
  return stripped
}

function scanCodeForApiUsage(text) {
  const cleaned = stripCommentsForScan(text)
  const methods = new Set()
  const events = new Set()
  let m
  CALL_RE.lastIndex = 0
  while ((m = CALL_RE.exec(cleaned)) !== null) methods.add(m[1])
  SHORTHAND_RE.lastIndex = 0
  while ((m = SHORTHAND_RE.exec(cleaned)) !== null) {
    if (RESERVED_HOLDER_FIELDS.has(m[1])) continue
    methods.add(`${m[1]}.${m[2]}`)
  }
  ON_RE.lastIndex = 0
  while ((m = ON_RE.exec(cleaned)) !== null) events.add(m[1])
  OFF_RE.lastIndex = 0
  while ((m = OFF_RE.exec(cleaned)) !== null) events.add(m[1])
  return { methods, events }
}

// ---- Design compliance (DESIGN_GUIDE.md) ------------------------------------

const ALLOWED_COLOR_KEYWORDS = new Set([
  'inherit', 'initial', 'unset', 'revert', 'currentcolor', 'transparent', 'none',
])
const NAMED_COLOR_RE = /\b(black|white|red|green|blue|yellow|gray|grey|purple|orange|pink|brown|cyan|magenta|silver|gold|maroon|navy|teal|olive|aqua|fuchsia|lime|violet|indigo|coral|crimson|salmon|khaki|beige|ivory|wheat|tan|chocolate|tomato|turquoise|orchid)\b/i
const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g
const RGB_HSL_RE = /\b(?:rgb|rgba|hsl|hsla)\s*\(/g
const COLOR_PROP_RE = /(?:^|[\s;{])(color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]+)/gi

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function checkDesignCompliance(files) {
  const violations = []
  const cssChunks = []
  let sawAnyHtml = false
  let sawAnyCss = false

  for (const [name, text] of files) {
    if (/\.css$/i.test(name)) {
      sawAnyCss = true
      cssChunks.push({ name, css: text })
    } else if (/\.html?$/i.test(name)) {
      sawAnyHtml = true
      const rootMatch = text.match(/<html\b([^>]*)>/i)
      if (rootMatch) {
        const attrs = rootMatch[1]
        if (!/\bdir\s*=\s*['"]\s*rtl\s*['"]/i.test(attrs)) {
          violations.push(`${name}: תג <html> חייב לכלול dir="rtl"`)
        }
        if (!/\blang\s*=\s*['"]\s*he\s*['"]/i.test(attrs)) {
          violations.push(`${name}: תג <html> חייב לכלול lang="he"`)
        }
      }
      const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi
      let sm
      while ((sm = styleRe.exec(text)) !== null) {
        cssChunks.push({ name: `${name} (<style>)`, css: sm[1] })
      }
    }
  }

  if (!sawAnyHtml && !sawAnyCss) {
    return { compliant: false, violations: ['לא נמצאו קבצי HTML/CSS שניתן לבדוק את תאימות העיצוב שלהם'] }
  }

  for (const { name, css } of cssChunks) {
    const stripped = stripCssComments(css).replace(/--[a-zA-Z_][\w-]*\s*:\s*[^;}]+;?/g, '')
    const seen = new Set()
    const addOnce = (type, message) => {
      if (seen.has(type)) return
      seen.add(type)
      violations.push(message)
    }

    const hexMatches = stripped.match(HEX_COLOR_RE) || []
    if (hexMatches.length > 0) {
      const sample = [...new Set(hexMatches)].slice(0, 3).join(', ')
      addOnce('hex', `${name}: צבעי hex מקודדים (${sample}). חובה var(--color-*)`)
    }

    RGB_HSL_RE.lastIndex = 0
    if (RGB_HSL_RE.test(stripped)) {
      addOnce('rgb', `${name}: ערכי rgb()/rgba()/hsl()/hsla() מקודדים. חובה var(--color-*)`)
    }

    COLOR_PROP_RE.lastIndex = 0
    let propMatch
    while ((propMatch = COLOR_PROP_RE.exec(stripped)) !== null) {
      const value = propMatch[2].trim()
      if (/var\s*\(/.test(value)) continue
      const firstToken = value.split(/[\s,]/)[0].toLowerCase()
      if (ALLOWED_COLOR_KEYWORDS.has(firstToken)) continue
      if (/^[\d.]+(px|em|rem|%)?$/.test(firstToken)) continue
      if (NAMED_COLOR_RE.test(value)) {
        addOnce('named', `${name}: שם צבע באנגלית בערך CSS ("${value.slice(0, 40)}"). חובה var(--color-*)`)
        break
      }
    }

    const fontFamRe = /font-family\s*:\s*([^;}]+)/gi
    let fmMatch
    while ((fmMatch = fontFamRe.exec(stripped)) !== null) {
      const value = fmMatch[1].trim()
      if (!/var\s*\(\s*--font/i.test(value)) {
        addOnce('font-family', `${name}: font-family מקודד ("${value.slice(0, 50)}"). חובה var(--font-main)`)
        break
      }
    }

    const fontSizeRe = /font-size\s*:\s*([^;}]+)/gi
    let fsMatch
    while ((fsMatch = fontSizeRe.exec(stripped)) !== null) {
      const value = fsMatch[1].trim()
      if (/var\s*\(/.test(value)) continue
      if (/^\d+(?:\.\d+)?\s*(?:em|rem|%)$/i.test(value)) continue
      if (/^0(?:px)?$/.test(value)) continue
      if (/\d+\s*px/i.test(value)) {
        addOnce('font-size-px', `${name}: font-size ב-px קבוע ("${value.slice(0, 30)}"). חובה em/rem או var(--font-size-base)`)
        break
      }
    }

    const radiusRe = /border-radius\s*:\s*([^;}]+)/gi
    let brMatch
    while ((brMatch = radiusRe.exec(stripped)) !== null) {
      const value = brMatch[1].trim()
      if (/var\s*\(/.test(value)) continue
      if (/^0(?:px)?(?:\s+0(?:px)?)*$/.test(value)) continue
      if (/^\d+(?:\.\d+)?\s*%$/.test(value)) continue
      if (/\d+\s*px/i.test(value)) {
        addOnce('radius-px', `${name}: border-radius ב-px קבוע ("${value.slice(0, 30)}"). חובה var(--radius-sm/md/lg/pill)`)
        break
      }
    }
  }

  const usesColorVar = cssChunks.some(({ css }) => /var\s*\(\s*--color-/i.test(css))
  if (cssChunks.length > 0 && !usesColorVar) {
    violations.push('לא נמצא שימוש כלשהו ב-var(--color-*) — חובה להזין צבעים מ-API לפי תיעוד העיצוב')
  }

  return { compliant: violations.length === 0, violations }
}

// ---- Extended validation entry point ----------------------------------------

/**
 * Extended (non-blocking) validation: network advisories, unknown API/event
 * usage, missing permissions, and design compliance.
 * Port of PluginExtendedValidator.validate.
 *
 * @param {object} args
 * @param {object} args.manifest normalized manifest
 * @param {Map<string,string>} args.files map of relative name -> text contents
 * @param {{permissions:Set,apiMethods:Set,events:Set}} args.spec merged API spec
 * @returns {{warnings:string[], design:{compliant:boolean,violations:string[]}}}
 */
function runExtendedValidation({ manifest, files, spec }) {
  const warnings = []
  const declared = new Set(manifest.permissions)
  const undocumented = new Set(KNOWN_UNDOCUMENTED_METHODS)

  // Network advisories (declarative field; never blocking).
  const networkRequested = manifest.networkEnabled || declared.has('network.access')
  if (networkRequested) {
    const allowlist = manifest.networkAllowlist
    if (!Array.isArray(allowlist) || allowlist.length === 0) {
      warnings.push(
        'התוסף מבקש network.access או network.enabled אך network.allowlist ריק. השדה הוא הצהרתי בלבד (התיעוד בפועל מוגדר באוצריא), אך מומלץ לפרט את הכתובות שבהן התוסף עושה שימוש לטובת שקיפות מול המשתמש'
      )
    } else {
      for (const raw of allowlist) {
        if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) {
          warnings.push(`כתובת לא תקינה ב-network.allowlist: ${JSON.stringify(raw)} (מומלץ http(s) URL מלא)`)
        } else if (raw.includes('*')) {
          warnings.push(`network.allowlist אינו תומך ב-wildcard: ${raw}`)
        }
      }
    }
  }

  const apiUsage = new Map()
  const eventUsage = new Map()
  for (const [name, text] of files) {
    if (!isCodeLikeFile(name)) continue
    const { methods, events } = scanCodeForApiUsage(text)
    for (const method of methods) {
      if (!apiUsage.has(method)) apiUsage.set(method, new Set())
      apiUsage.get(method).add(name)
    }
    for (const ev of events) {
      if (!eventUsage.has(ev)) eventUsage.set(ev, new Set())
      eventUsage.get(ev).add(name)
    }
  }

  for (const [method, sources] of apiUsage) {
    if (spec.apiMethods.has(method) || undocumented.has(method)) continue
    warnings.push(`קריאה ל-API לא מוכר: ${method} (קבצים: ${[...sources].join(', ')})`)
  }

  for (const [ev, sources] of eventUsage) {
    if (spec.events.has(ev)) continue
    warnings.push(`רישום ל-event לא מוכר: ${ev} (קבצים: ${[...sources].join(', ')})`)
  }

  for (const method of apiUsage.keys()) {
    const required = METHOD_REQUIRED_PERMISSION[method]
    if (!required) continue
    if (!declared.has(required)) {
      warnings.push(`התוסף משתמש ב-${method} אך לא ביקש את ההרשאה "${required}" ב-manifest`)
    }
  }

  for (const ev of eventUsage.keys()) {
    const eventPerm = `events.subscribe:${ev}`
    if (!spec.permissions.has(eventPerm)) continue
    if (!declared.has(eventPerm)) {
      warnings.push(`רישום ל-event "${ev}" דורש את ההרשאה "${eventPerm}" שלא הוכרזה ב-manifest`)
    }
  }

  let design = { compliant: false, violations: [] }
  try {
    const styleFiles = new Map()
    for (const [name, text] of files) {
      if (isStyleLikeFile(name)) styleFiles.set(name, text)
    }
    design = checkDesignCompliance(styleFiles)
  } catch (_e) {
    // design scan is best-effort; never fatal
  }

  return { warnings, design }
}

module.exports = {
  runExtendedValidation,
  checkDesignCompliance,
  scanCodeForApiUsage,
  stripCommentsForScan,
  isCodeLikeFile,
  isStyleLikeFile,
}
