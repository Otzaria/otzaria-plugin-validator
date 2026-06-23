'use strict'

const fs = require('fs')
const path = require('path')

// Optional per-plugin exclude file. Place an `.otzignore` in the plugin root to
// keep files OUT of the built .otzplugin (dev assets, raw sources, large data
// not needed at runtime, etc.). Syntax mirrors .gitignore:
//   - one pattern per line; blank lines and lines starting with `#` are ignored
//   - `*` matches within a path segment, `**` across segments, `?` one char
//   - a trailing `/` matches a directory (and everything under it)
//   - a pattern with no `/` matches by basename at any depth (e.g. `*.map`)
//   - a pattern with a `/` is anchored to the plugin root (e.g. `src/dev.js`)
//   - a leading `!` re-includes a path excluded by an earlier pattern
// Patterns are compiled to RegExp here — no runtime dependency.

const IGNORE_FILENAME = '.otzignore'

// Translate one glob (already stripped of `!`, leading `/` and trailing `/`)
// into a RegExp source that matches a forward-slash relative path.
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++ // consume the second star
        if (glob[i + 1] === '/') {
          i++ // consume the slash: `**/` spans zero or more directories
          re += '(?:[^/]+/)*'
        } else {
          re += '.*' // trailing `**` spans anything, separators included
        }
      } else {
        re += '[^/]*' // `*` stays within a single segment
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return re
}

// Compile one source line into { negate, test(relPath) }, or null to skip it.
function compileLine(line) {
  let pat = line.trim()
  if (!pat || pat.startsWith('#')) return null

  let negate = false
  if (pat.startsWith('!')) {
    negate = true
    pat = pat.slice(1)
  }

  let dirOnly = false
  if (pat.endsWith('/')) {
    dirOnly = true
    pat = pat.slice(0, -1)
  }

  // A `/` anywhere (other than the trailing one already removed) anchors the
  // pattern to the root; otherwise it matches by basename at any depth.
  const anchored = pat.includes('/')
  pat = pat.replace(/^\//, '')
  const body = globToRegExp(pat)

  // Match the path itself OR anything beneath it (so a matched directory
  // excludes its whole subtree). Directory-only patterns must have a child
  // segment, so they never match a plain file of the same name.
  const tail = dirOnly ? '/.*' : '(?:/.*)?'
  const prefix = anchored ? '^' : '(?:^|.*/)'
  const re = new RegExp(`${prefix}${body}${tail}$`)
  return { negate, test: (relPath) => re.test(relPath) }
}

/**
 * Build a matcher from `.otzignore` lines. The returned predicate reports
 * whether a forward-slash relative path is excluded; the last matching pattern
 * wins, so a later `!pattern` can re-include an earlier exclusion.
 */
function buildMatcher(lines) {
  const rules = lines.map(compileLine).filter(Boolean)
  const hasNegation = rules.some((r) => r.negate)
  const ignores = (relPath) => {
    let excluded = false
    for (const r of rules) {
      if (r.test(relPath)) excluded = !r.negate
    }
    return excluded
  }
  return { ignores, hasNegation, count: rules.length }
}

/**
 * Load `.otzignore` from a plugin root and return a matcher. When the file is
 * absent the matcher excludes nothing.
 */
function loadIgnore(root) {
  const file = path.join(root, IGNORE_FILENAME)
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (_e) {
    return buildMatcher([])
  }
  return buildMatcher(text.split(/\r?\n/))
}

module.exports = { IGNORE_FILENAME, loadIgnore, buildMatcher }
