'use strict'

const fs = require('fs')
const path = require('path')
const { SKIP_DIRS } = require('./knownApi')
const { extractZipFiles } = require('./zip')
const {
  parseManifestJson,
  buildManifest,
  validateManifestFields,
} = require('./manifestValidator')
const { runExtendedValidation, isCodeLikeFile, isStyleLikeFile } = require('./extendedValidator')

const SCANNABLE = (name) => name === 'manifest.json' || isCodeLikeFile(name) || isStyleLikeFile(name)

// Read manifest text + scannable file texts from a plugin directory.
function collectFromDir(root) {
  const fileTexts = new Map()
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_e) {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        walk(full)
      } else if (ent.isFile()) {
        const rel = path.relative(root, full).replace(/\\/g, '/')
        if (!SCANNABLE(rel)) continue
        try {
          fileTexts.set(rel, fs.readFileSync(full, 'utf8'))
        } catch (_e) { /* skip unreadable */ }
      }
    }
  }
  walk(root)

  const manifestText = fileTexts.has('manifest.json') ? fileTexts.get('manifest.json') : null
  const entrypointExists = (rel) => {
    const target = path.resolve(root, rel)
    return fs.existsSync(target) && fs.statSync(target).isFile()
  }
  const entrypointWithinBounds = (rel) => {
    const target = path.resolve(root, rel)
    const relBack = path.relative(root, target)
    return relBack !== '' && !relBack.startsWith('..') && !path.isAbsolute(relBack)
  }
  return { manifestText, fileTexts, entrypointExists, entrypointWithinBounds }
}

// Read manifest text + scannable file texts from an .otzplugin archive.
function collectFromZip(file) {
  const buffer = fs.readFileSync(file)
  const raw = extractZipFiles(buffer)
  const fileTexts = new Map()
  for (const [name, buf] of raw) {
    if (SCANNABLE(name)) fileTexts.set(name, buf.toString('utf8'))
  }
  const manifestText = fileTexts.has('manifest.json') ? fileTexts.get('manifest.json') : null
  const entrypointExists = (rel) => raw.has(rel)
  const entrypointWithinBounds = (rel) =>
    !rel.startsWith('/') && !path.isAbsolute(rel) && !rel.split('/').includes('..')
  return { manifestText, fileTexts, entrypointExists, entrypointWithinBounds }
}

// Validate one plugin. Returns:
//   { label, errors:[], warnings:[], design:{compliant,violations}|null,
//     manifest:object|null, manifestFile:string }
function validateCore({ label, manifestFile, collected, spec, appVersion, skipAppVersion }) {
  const { manifestText, fileTexts, entrypointExists, entrypointWithinBounds } = collected
  const errors = []

  if (manifestText == null) {
    errors.push('הקובץ manifest.json לא נמצא. תוסף תקין חייב לכלול manifest.json בשורש.')
    return { label, manifestFile, errors, warnings: [], design: null, manifest: null }
  }

  let json
  try {
    json = parseManifestJson(manifestText)
  } catch (e) {
    errors.push(`הקובץ manifest.json אינו JSON תקין: ${e.message}`)
    return { label, manifestFile, errors, warnings: [], design: null, manifest: null }
  }

  let manifest
  try {
    manifest = buildManifest(json)
  } catch (e) {
    errors.push(`נכשלה קריאת manifest.json לתוך מבנה PluginManifest: ${e.message}`)
    return { label, manifestFile, errors, warnings: [], design: null, manifest: null }
  }

  for (const err of validateManifestFields({
    manifest,
    validPermissions: spec.permissions,
    appVersion,
    skipAppVersionValidation: skipAppVersion,
  })) {
    errors.push(err)
  }

  // Entrypoint checks (blocking).
  const entry = manifest.entrypoint
  if (!entrypointWithinBounds(entry)) {
    errors.push(`נתיב קובץ הכניסה ${entry} חורג מגבולות תיקיית התוסף`)
  } else if (!entrypointExists(entry)) {
    errors.push(`קובץ הכניסה ${entry} לא נמצא בתיקייה`)
  } else {
    const blocked = entry.split(/[\\/]/).find((seg) => SKIP_DIRS.has(seg))
    if (blocked) {
      errors.push(
        `קובץ הכניסה "${entry}" נמצא בתוך תיקייה מוחרגת מאריזה ("${blocked}"). ` +
        `העבר את ה-entrypoint מחוץ לתיקיות: ${[...SKIP_DIRS].join(', ')}`
      )
    }
  }

  // Blocking errors stop here, exactly like the packager (extended runs only on success).
  if (errors.length > 0) {
    return { label, manifestFile, errors, warnings: [], design: null, manifest }
  }

  const { warnings, design } = runExtendedValidation({ manifest, files: fileTexts, spec })
  return { label, manifestFile, errors, warnings, design, manifest }
}

function validateSource(source, opts) {
  if (source.kind === 'zip') {
    const collected = collectFromZip(source.file)
    return validateCore({
      label: source.file,
      manifestFile: source.file,
      collected,
      ...opts,
    })
  }
  const collected = collectFromDir(source.root)
  return validateCore({
    label: source.root,
    manifestFile: path.join(source.root, 'manifest.json'),
    collected,
    ...opts,
  })
}

module.exports = { validateSource, collectFromDir, collectFromZip }
