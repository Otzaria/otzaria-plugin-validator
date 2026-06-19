'use strict'

const zlib = require('zlib')

// Minimal ZIP reader for .otzplugin archives (stored + deflate only).
// Parses the End Of Central Directory, walks the central directory, and
// inflates each entry from its local header. Avoids any runtime dependency.

const EOCD_SIG = 0x06054b50
const CDH_SIG = 0x02014b50
const LFH_SIG = 0x04034b50

function findEocd(buf) {
  // EOCD is at the very end, possibly followed by a comment (max 65535 bytes).
  const minEocd = 22
  const maxBack = Math.min(buf.length, minEocd + 0xffff)
  for (let i = buf.length - minEocd; i >= buf.length - maxBack; i--) {
    if (i < 0) break
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

/**
 * Extract files from a ZIP buffer.
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>} map of entry name -> file contents
 */
function extractZipFiles(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('Not a valid ZIP file: EOCD not found')

  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported')
  }

  const files = new Map()
  let ptr = cdOffset
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== CDH_SIG) {
      throw new Error('Not a valid ZIP file: bad central directory header')
    }
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    ptr += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory entry

    if (buf.readUInt32LE(localOffset) !== LFH_SIG) {
      throw new Error('Not a valid ZIP file: bad local file header')
    }
    const lfhNameLen = buf.readUInt16LE(localOffset + 26)
    const lfhExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)

    let content
    if (method === 0) {
      content = Buffer.from(raw)
    } else if (method === 8) {
      content = zlib.inflateRawSync(raw)
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`)
    }
    files.set(name.replace(/\\/g, '/'), content)
  }
  return files
}

module.exports = { extractZipFiles }
