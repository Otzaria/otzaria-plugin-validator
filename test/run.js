'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { validateSource } = require('../src/validatePlugin')
const { extractZipFiles } = require('../src/zip')
const { buildFallbackSpec, mergeWithFallback, parseApiReferenceMarkdown } = require('../src/apiSpec')

const spec = mergeWithFallback(buildFallbackSpec())
const opts = { spec, appVersion: null, skipAppVersion: true }
const fx = (name) => path.join(__dirname, 'fixtures', name)

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    process.stdout.write(`  ✓ ${name}\n`)
  } catch (e) {
    failed++
    process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`)
  }
}

// Build a minimal stored (uncompressed) ZIP for the reader test.
function makeStoredZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4)
    lfh.writeUInt16LE(0, 8) // method = store
    lfh.writeUInt32LE(0, 14) // crc (reader ignores)
    lfh.writeUInt32LE(data.length, 18)
    lfh.writeUInt32LE(data.length, 22)
    lfh.writeUInt16LE(nameBuf.length, 26)
    const local = Buffer.concat([lfh, nameBuf, data])

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4)
    cdh.writeUInt16LE(20, 6)
    cdh.writeUInt16LE(0, 10) // method = store
    cdh.writeUInt32LE(data.length, 20)
    cdh.writeUInt32LE(data.length, 24)
    cdh.writeUInt16LE(nameBuf.length, 28)
    cdh.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([cdh, nameBuf]))

    locals.push(local)
    offset += local.length
  }
  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)
  return Buffer.concat([localPart, centralPart, eocd])
}

process.stdout.write('Otzaria Plugin Validator — tests\n')

test('valid plugin passes with no errors', () => {
  const r = validateSource({ kind: 'dir', root: fx('valid-plugin') }, opts)
  assert.deepStrictEqual(r.errors, [], `unexpected errors: ${r.errors.join(' | ')}`)
})

test('valid plugin is design-compliant', () => {
  const r = validateSource({ kind: 'dir', root: fx('valid-plugin') }, opts)
  assert.strictEqual(r.design.compliant, true, r.design.violations.join(' | '))
})

test('invalid plugin produces blocking errors', () => {
  const r = validateSource({ kind: 'dir', root: fx('invalid-plugin') }, opts)
  const joined = r.errors.join('\n')
  assert.ok(r.errors.length >= 5, `expected many errors, got ${r.errors.length}`)
  assert.ok(joined.includes('מזהה התוסף אינו תקין'), 'missing id error')
  assert.ok(joined.includes('SemVer'), 'missing version error')
  assert.ok(joined.includes('האם התכוונת ל-"library.books.read"'), 'missing permission hint')
  assert.ok(joined.includes('הרשאה לא חוקית שנדרשת על ידי התוסף: totally.made.up'), 'missing invalid-perm error')
  assert.ok(joined.includes('toolTab.iconName'), 'missing iconName error')
  assert.ok(joined.includes('קובץ הכניסה does-not-exist.js לא נמצא'), 'missing entrypoint error')
})

test('invalid plugin skips extended validation when blocked', () => {
  const r = validateSource({ kind: 'dir', root: fx('invalid-plugin') }, opts)
  assert.deepStrictEqual(r.warnings, [])
})

test('warnings plugin has no errors but emits warnings', () => {
  const r = validateSource({ kind: 'dir', root: fx('warnings-plugin') }, opts)
  assert.deepStrictEqual(r.errors, [], `unexpected errors: ${r.errors.join(' | ')}`)
  const joined = r.warnings.join('\n')
  assert.ok(joined.includes('קריאה ל-API לא מוכר: totally.unknown.method'), 'missing unknown-api warning')
  assert.ok(joined.includes('רישום ל-event לא מוכר: made.up.event'), 'missing unknown-event warning')
  assert.ok(joined.includes('אך לא ביקש את ההרשאה "library.books.read"'), 'missing permission warning')
})

test('missing manifest reports a single blocking error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  const r = validateSource({ kind: 'dir', root: tmp }, opts)
  assert.ok(r.errors[0].includes('manifest.json לא נמצא'))
})

test('invalid JSON reports a parse error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), '{ not json ')
  const r = validateSource({ kind: 'dir', root: tmp }, opts)
  assert.ok(r.errors[0].includes('אינו JSON תקין'))
})

test('missing required field reports fromJson error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ id: 'x', name: 'y', version: '1.0.0' }))
  const r = validateSource({ kind: 'dir', root: tmp }, opts)
  assert.ok(r.errors[0].includes('PluginManifest'), r.errors.join(' | '))
})

test('zip reader round-trips stored entries', () => {
  const buf = makeStoredZip({ 'manifest.json': '{"id":"a"}', 'index.js': 'console.log(1)' })
  const files = extractZipFiles(buf)
  assert.strictEqual(files.get('manifest.json').toString('utf8'), '{"id":"a"}')
  assert.strictEqual(files.get('index.js').toString('utf8'), 'console.log(1)')
})

test('zip-based plugin validates end to end', () => {
  const buf = makeStoredZip({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.z', name: 'z', version: '1.0.0',
      entrypoint: 'index.js', permissions: ['app.info.read'],
    }),
    'index.js': "Otzaria.call('app.getInfo')",
  })
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')
  fs.writeFileSync(tmp, buf)
  const r = validateSource({ kind: 'zip', file: tmp }, opts)
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
})

test('API reference markdown parser extracts methods and permissions', () => {
  const md = [
    '### `app.getInfo`',
    '### `app.getTheme`',
    '### `app.getLocale`',
    '### `library.getBookContent`',
    '### `library.getBookToc`',
    '### `reader.openBook`',
    '### `notes.add`',
    '### `notes.update`',
    '### `settings.get`',
    '### `calendar.getEvents`',
    '**הרשאה נדרשת:** `app.info.read`',
    "Otzaria.call('library.findBooks', {})",
    '`library.books.read`',
    "Otzaria.on('theme.changed', cb)",
    'events.subscribe:settings.changed',
    '`reader.open` `notes.read` `notes.write` `calendar.read` `ui.feedback`',
  ].join('\n')
  const parsed = parseApiReferenceMarkdown(md)
  assert.ok(parsed.apiMethods.has('app.getInfo'))
  assert.ok(parsed.apiMethods.has('library.findBooks'))
  assert.ok(parsed.permissions.has('app.info.read'))
  assert.ok(parsed.permissions.has('events.subscribe:settings.changed'))
  assert.ok(parsed.events.has('theme.changed'))
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
