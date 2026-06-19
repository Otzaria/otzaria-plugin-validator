'use strict'

const path = require('path').posix

// Static reachability analysis: which packaged files are referenced, starting
// from the manifest (entrypoint + icon) and walking HTML/CSS/JS imports.
//
// This is REPORT-ONLY. It cannot see dynamic references (fetch with a computed
// path, dynamic import of a built string, etc.), so files it marks as
// "unreferenced" are only *candidates* for removal — never dropped automatically.

const isCode = (n) => /\.(?:js|mjs|cjs)$/i.test(n)
const isStyle = (n) => /\.css$/i.test(n)
const isHtml = (n) => /\.html?$/i.test(n)

// External / non-file references we never resolve to a packaged file.
function isExternal(ref) {
  return (
    ref === '' ||
    ref.startsWith('#') ||
    ref.startsWith('//') ||
    ref.startsWith('/') ||
    ref.startsWith('data:') ||
    ref.startsWith('mailto:') ||
    /^[a-z][a-z0-9+.-]*:/i.test(ref) // http:, https:, blob:, etc.
  )
}

function cleanRef(ref) {
  return ref.split('#')[0].split('?')[0].trim()
}

function refsFromHtml(text) {
  const out = []
  let m
  const attrRe = /<(?:script|img|source|audio|video|track|iframe|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi
  while ((m = attrRe.exec(text)) !== null) out.push(m[1])
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
  while ((m = urlRe.exec(text)) !== null) out.push(m[1])
  return out
}

function refsFromCss(text) {
  const out = []
  let m
  const importRe = /@import\s+(?:url\()?\s*["']([^"']+)["']/gi
  while ((m = importRe.exec(text)) !== null) out.push(m[1])
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi
  while ((m = urlRe.exec(text)) !== null) out.push(m[1])
  return out
}

function refsFromJs(text) {
  const out = []
  let m
  const patterns = [
    /\bimport\s+(?:[^'"();]*?\sfrom\s*)?["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /new\s+Worker\(\s*["']([^"']+)["']/g,
    /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
  ]
  for (const re of patterns) {
    while ((m = re.exec(text)) !== null) out.push(m[1])
  }
  return out
}

// Resolve a reference (relative to the file it appears in) to a packaged name.
function resolveRef(fromFile, ref, allSet) {
  const base = path.dirname(fromFile)
  const joined = path.normalize(path.join(base, ref)).replace(/^\.\//, '')
  const candidates = [joined]
  if (!/\.[a-z0-9]+$/i.test(joined)) {
    candidates.push(`${joined}.js`, `${joined}.mjs`, `${joined}/index.js`, `${joined}.css`)
  }
  return candidates.find((c) => allSet.has(c)) || null
}

/**
 * @param {object} args
 * @param {string[]} args.allNames every packaged file name (forward-slash, relative)
 * @param {Map<string,string>} args.texts contents of HTML/CSS/JS files
 * @param {object} args.manifest normalized manifest (entrypoint, icon, raw)
 * @returns {{reachable:string[], unreferenced:string[]}}
 */
function analyzeReachability({ allNames, texts, manifest }) {
  const allSet = new Set(allNames)
  const reachable = new Set()
  const queue = []
  const enqueue = (name) => {
    if (name && allSet.has(name) && !reachable.has(name)) {
      reachable.add(name)
      queue.push(name)
    }
  }

  enqueue('manifest.json')
  if (manifest.entrypoint) enqueue(path.normalize(manifest.entrypoint).replace(/^\.\//, ''))
  const icon = manifest.raw && typeof manifest.raw.icon === 'string' ? manifest.raw.icon : null
  if (icon) enqueue(path.normalize(icon).replace(/^\.\//, ''))

  while (queue.length) {
    const name = queue.shift()
    const text = texts.get(name)
    if (text == null) continue
    let refs = []
    if (isHtml(name)) refs = refsFromHtml(text)
    else if (isStyle(name)) refs = refsFromCss(text)
    else if (isCode(name)) refs = refsFromJs(text)
    for (const raw of refs) {
      const ref = cleanRef(raw)
      if (isExternal(ref)) continue
      const resolved = resolveRef(name, ref, allSet)
      if (resolved) enqueue(resolved)
    }
  }

  const unreferenced = allNames.filter((n) => n !== 'manifest.json' && !reachable.has(n)).sort()
  return { reachable: [...reachable], unreferenced }
}

module.exports = { analyzeReachability }
