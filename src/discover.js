'use strict'

const fs = require('fs')
const path = require('path')
const { SKIP_DIRS } = require('./knownApi')

// Find every plugin under a path. Handles a single plugin directory, a monorepo
// with many plugins, a bare manifest.json, or a packaged .otzplugin file.
//
// Returns an array of sources:
//   { kind: 'dir', root: absoluteDir }
//   { kind: 'zip', file: absoluteFile }
function discoverPlugins(inputPath) {
  const abs = path.resolve(inputPath)
  let stat
  try {
    stat = fs.statSync(abs)
  } catch (_e) {
    throw new Error(`הנתיב לא נמצא: ${abs}`)
  }

  if (stat.isFile()) {
    if (abs.toLowerCase().endsWith('.otzplugin')) return [{ kind: 'zip', file: abs }]
    if (path.basename(abs) === 'manifest.json') return [{ kind: 'dir', root: path.dirname(abs) }]
    throw new Error(`קובץ לא נתמך לבדיקה: ${abs} (נדרש manifest.json או קובץ .otzplugin)`)
  }

  // A directory that is itself a plugin root.
  if (fs.existsSync(path.join(abs, 'manifest.json'))) {
    return [{ kind: 'dir', root: abs }]
  }

  // Otherwise scan recursively for plugins.
  const sources = []
  const seenDirs = new Set()
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_e) {
      return
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        walk(path.join(dir, ent.name))
      } else if (ent.isFile()) {
        if (ent.name === 'manifest.json') {
          if (!seenDirs.has(dir)) {
            seenDirs.add(dir)
            sources.push({ kind: 'dir', root: dir })
          }
        } else if (ent.name.toLowerCase().endsWith('.otzplugin')) {
          sources.push({ kind: 'zip', file: path.join(dir, ent.name) })
        }
      }
    }
  }
  walk(abs)

  if (sources.length === 0) {
    throw new Error(`לא נמצאו תוספים תחת ${abs} (אין manifest.json או קובץ .otzplugin)`)
  }
  return sources
}

module.exports = { discoverPlugins }
