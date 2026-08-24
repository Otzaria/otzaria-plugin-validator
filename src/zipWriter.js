'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { SKIP_DIRS, isMetadataDir, isMetadataFile } = require('./knownApi')
const { loadIgnore, IGNORE_FILENAME } = require('./ignore')

// Minimal ZIP writer for building .otzplugin archives (deflate + CRC32).
// Produces a standard archive that the store's unzipper (fflate) and the
// Otzaria app both accept. No runtime dependency.

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let crc = -1
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

// Collect packable files from a plugin directory, skipping dev dirs, the output
// file itself, and anything matched by the plugin's optional .otzignore.
// A metadata file/dir (docs, LICENSE, screenshots/, .well-known/...) is packed
// only when an explicit `!` line in .otzignore re-includes it.
// Returns { files, excluded, metadataExcluded, ignore } with forward-slash names.
function collectFiles(root, outputAbs) {
  const out = []
  let excluded = 0
  const metadataExcluded = []
  const ignore = loadIgnore(root)
  const walk = (dir, inMetadata) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      const rel = path.relative(root, full).replace(/\\/g, '/')
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        const meta = inMetadata || isMetadataDir(ent.name)
        // Without any `!` line nothing inside a metadata dir can come back, so
        // prune it — and prune a plainly ignored dir the same way.
        if (meta && !ignore.hasNegation) continue
        if (!ignore.hasNegation && ignore.ignores(rel)) continue
        walk(full, meta)
      } else if (ent.isFile()) {
        if (path.resolve(full) === outputAbs) continue
        if (ent.name === IGNORE_FILENAME) continue
        if (inMetadata || isMetadataFile(rel)) {
          if (!ignore.reIncludes(rel)) { metadataExcluded.push(rel); continue }
        } else if (ignore.ignores(rel)) { excluded++; continue }
        out.push({ name: rel, data: fs.readFileSync(full) })
      }
    }
  }
  walk(root, false)
  return { files: out, excluded, metadataExcluded, ignore }
}

// A packed entrypoint that silently never lands in the archive breaks the
// plugin at runtime with no error — mirror the Dart packager and fail loudly.
function assertEntrypointPacked(files, ignore, label, entrypoint) {
  if (!entrypoint) return
  const rel = entrypoint.replace(/\\/g, '/').replace(/^\.\//, '')
  if (files.some((f) => f.name === rel)) return
  const reason = ignore.ignores(rel)
    ? `מוחרג ע"י ${IGNORE_FILENAME}`
    : 'מסווג כקובץ/תיקיית מטא-דאטה ולכן מוחרג מהאריזה'
  throw new Error(
    `${label} "${entrypoint}" ${reason} ולכן לא ייכלל ב-.otzplugin. ` +
      `הוצא אותו מהתיקיות המוחרגות, או החזר אותו עם שורת "!${rel}" ב-${IGNORE_FILENAME}.`,
  )
}

/**
 * Build a .otzplugin archive from a plugin directory.
 * @param {object} [manifest] parsed manifest — enables the entrypoint guard.
 * @returns {{ path:string, fileCount:number, bytes:number, sha256:string }}
 */
function buildOtzplugin(root, outputPath, manifest) {
  const outputAbs = path.resolve(outputPath)
  const { files, excluded, metadataExcluded, ignore } = collectFiles(root, outputAbs)

  if (manifest) {
    assertEntrypointPacked(files, ignore, 'קובץ הכניסה', manifest.entrypoint)
    assertEntrypointPacked(files, ignore, 'קובץ הרקע', manifest.backgroundEntrypoint)
  }

  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const compressed = zlib.deflateRawSync(data)
    const useStore = compressed.length >= data.length
    const method = useStore ? 0 : 8
    const payload = useStore ? data : compressed

    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(method, 8)
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(payload.length, 18)
    lfh.writeUInt32LE(data.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    locals.push(lfh, nameBuf, payload)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4)
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(method, 10)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(payload.length, 20)
    cdh.writeUInt32LE(data.length, 24)
    cdh.writeUInt16LE(nameBuf.length, 28)
    cdh.writeUInt32LE(offset, 42)
    centrals.push(cdh, nameBuf)

    offset += 30 + nameBuf.length + payload.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)

  const archive = Buffer.concat([localPart, centralPart, eocd])
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true })
  fs.writeFileSync(outputAbs, archive)

  const crypto = require('crypto')
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex')
  return {
    path: outputPath,
    fileCount: files.length,
    excludedCount: excluded,
    metadataExcluded,
    bytes: archive.length,
    sha256,
  }
}

module.exports = { buildOtzplugin, crc32 }
