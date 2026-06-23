'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { validateSource } = require('../src/validatePlugin')
const { extractZipFiles } = require('../src/zip')
const { buildOtzplugin } = require('../src/zipWriter')
const { analyzeReachability } = require('../src/reachability')
const { resolveUpdateFields, imageContentType } = require('../src/publish')
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

test('zipWriter builds a deflate archive that the reader round-trips', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'built.otzplugin')
  const res = buildOtzplugin(fx('valid-plugin'), out)
  assert.ok(res.fileCount >= 3, `expected >=3 files, got ${res.fileCount}`)
  assert.match(res.sha256, /^[0-9a-f]{64}$/)
  const files = extractZipFiles(fs.readFileSync(out))
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
  assert.strictEqual(manifest.id, 'com.example.hello')
  assert.ok(files.get('index.js').toString('utf8').includes('app.getInfo'))
})

test('built archive passes validation end to end', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'built.otzplugin')
  buildOtzplugin(fx('valid-plugin'), out)
  const r = validateSource({ kind: 'zip', file: out }, opts)
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
})

test('zipWriter skips dev directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), '{"id":"x"}')
  fs.mkdirSync(path.join(tmp, 'node_modules'))
  fs.writeFileSync(path.join(tmp, 'node_modules', 'junk.js'), 'x')
  fs.mkdirSync(path.join(tmp, '.git'))
  fs.writeFileSync(path.join(tmp, '.git', 'config'), 'x')
  const out = path.join(tmp, 'out.otzplugin')
  buildOtzplugin(tmp, out)
  const files = extractZipFiles(fs.readFileSync(out))
  assert.ok(files.has('manifest.json'))
  assert.ok(![...files.keys()].some((n) => n.includes('node_modules') || n.includes('.git')))
})

test('reachability flags unreferenced files but keeps imported ones', () => {
  const allNames = ['manifest.json', 'index.html', 'js/app.js', 'css/style.css', 'assets/logo.png', 'orphan.js', 'leftover.txt']
  const texts = new Map([
    ['manifest.json', '{}'],
    ['index.html', '<html><link href="css/style.css"><script src="js/app.js"></script></html>'],
    ['js/app.js', "import './nothing'"],
    ['css/style.css', 'body{background:url(../assets/logo.png)}'],
  ])
  const manifest = { entrypoint: 'index.html', raw: {} }
  const { unreferenced } = analyzeReachability({ allNames, texts, manifest })
  assert.ok(unreferenced.includes('orphan.js'), 'orphan should be flagged')
  assert.ok(unreferenced.includes('leftover.txt'), 'leftover should be flagged')
  assert.ok(!unreferenced.includes('js/app.js'), 'imported js must not be flagged')
  assert.ok(!unreferenced.includes('css/style.css'), 'linked css must not be flagged')
  assert.ok(!unreferenced.includes('assets/logo.png'), 'css url() asset must not be flagged')
})

test('reachability ignores .otzignore-excluded files (no false unreferenced warning)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.y', name: 'y', version: '1.0.0', entrypoint: 'index.html',
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  fs.writeFileSync(path.join(tmp, 'package.json'), '{}')      // dev-only, excluded
  fs.mkdirSync(path.join(tmp, 'src'))
  fs.writeFileSync(path.join(tmp, 'src', 'main.ts'), 'x')     // bundled into dist, excluded
  fs.writeFileSync(path.join(tmp, '.otzignore'), 'src/\npackage.json\n')
  const report = validateSource({ kind: 'dir', root: tmp }, opts)
  assert.ok(!report.unreferenced.includes('package.json'), 'excluded package.json must not be flagged')
  assert.ok(!report.unreferenced.includes('src/main.ts'), 'excluded src/ contents must not be flagged')
})

test('packaging skips repo metadata (README, .github, dotfiles)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.y', name: 'y', version: '1.0.0', entrypoint: 'index.html',
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  fs.writeFileSync(path.join(tmp, 'README.md'), '# docs')
  fs.writeFileSync(path.join(tmp, 'LICENSE'), 'MIT')
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules')
  fs.mkdirSync(path.join(tmp, '.github'))
  fs.writeFileSync(path.join(tmp, '.github', 'workflow.yml'), 'name: x')
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')
  buildOtzplugin(tmp, out)
  const names = [...extractZipFiles(fs.readFileSync(out)).keys()]
  assert.ok(names.includes('manifest.json') && names.includes('index.html'))
  assert.ok(!names.some((n) => /README|LICENSE|\.gitignore|\.github/.test(n)), `metadata leaked: ${names.join(', ')}`)
})

test('.otzignore excludes files, dirs, and globs (with ! re-include)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.y', name: 'y', version: '1.0.0', entrypoint: 'index.html',
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  fs.writeFileSync(path.join(tmp, 'app.js'), 'x')
  fs.writeFileSync(path.join(tmp, 'app.js.map'), 'x')        // *.map glob
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x')         // anchored single file
  fs.mkdirSync(path.join(tmp, 'src'))
  fs.writeFileSync(path.join(tmp, 'src', 'raw.ts'), 'x')     // src/ dir prune
  fs.writeFileSync(path.join(tmp, 'src', 'keep.js'), 'x')    // re-included by !
  fs.writeFileSync(path.join(tmp, '.otzignore'),
    '# build excludes\n*.map\nnotes.txt\nsrc/\n!src/keep.js\n')
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')
  const res = buildOtzplugin(tmp, out)
  const names = [...extractZipFiles(fs.readFileSync(out)).keys()]
  assert.ok(names.includes('manifest.json') && names.includes('index.html') && names.includes('app.js'))
  assert.ok(!names.includes('app.js.map'), 'glob *.map should be excluded')
  assert.ok(!names.includes('notes.txt'), 'notes.txt should be excluded')
  assert.ok(!names.includes('src/raw.ts'), 'src/ contents should be excluded')
  assert.ok(names.includes('src/keep.js'), '!src/keep.js should be re-included')
  assert.ok(!names.includes('.otzignore'), '.otzignore itself should not be packed')
  assert.strictEqual(res.excludedCount, 3, `expected 3 excluded, got ${res.excludedCount}`)
})

test('publish syncs metadata fields from manifest (admin-equivalent update)', () => {
  const manifest = {
    name: 'New Name', version: '2.0.0', minAppVersion: '0.9.95',
    raw: { author: 'New Author', description: 'short new', stability: 'beta', homepage: 'https://x.example', network: { enabled: true } },
  }
  const current = {
    name: 'Old Name', author: 'Old Author', shortDescription: 'short old', status: 'stable',
    compatibleWith: '0.9.89', homepage: 'https://old.example', requiresNetwork: false,
    description: 'long curated store description', tags: ['a', 'b'],
  }
  const f = resolveUpdateFields({ manifest, current, syncMetadata: true })
  assert.strictEqual(f.name, 'New Name')
  assert.strictEqual(f.author, 'New Author')
  assert.strictEqual(f.shortDescription, 'short new')
  assert.strictEqual(f.status, 'beta')
  assert.strictEqual(f.compatibleWith, '0.9.95')
  assert.strictEqual(f.homepage, 'https://x.example')
  assert.strictEqual(f.requiresNetwork, 'true')
  assert.strictEqual(f.version, '2.0.0')
  // curated fields preserved
  assert.strictEqual(f.description, 'long curated store description')
  assert.strictEqual(f.tags, JSON.stringify(['a', 'b']))
})

test('screenshot content-type is inferred from extension', () => {
  assert.strictEqual(imageContentType('a/b/shot.png'), 'image/png')
  assert.strictEqual(imageContentType('shot.JPG'), 'image/jpeg')
  assert.strictEqual(imageContentType('shot.webp'), 'image/webp')
  assert.strictEqual(imageContentType('shot.bin'), 'application/octet-stream')
})

test('publish preserves store fields when sync-metadata is off', () => {
  const manifest = { name: 'New Name', version: '2.0.0', minAppVersion: '0.9.95', raw: { author: 'New Author' } }
  const current = { name: 'Old Name', author: 'Old Author', status: 'stable', compatibleWith: '0.9.89', description: 'd', shortDescription: 's', tags: [] }
  const f = resolveUpdateFields({ manifest, current, syncMetadata: false })
  assert.strictEqual(f.name, 'Old Name')
  assert.strictEqual(f.author, 'Old Author')
  assert.strictEqual(f.compatibleWith, '0.9.89')
  assert.strictEqual(f.version, '2.0.0') // version always bumped
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
