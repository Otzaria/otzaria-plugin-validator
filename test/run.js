'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { validateSource } = require('../src/validatePlugin')
const { checkDesignCompliance } = require('../src/extendedValidator')
const { buildManifest, validateManifestFields } = require('../src/manifestValidator')
const { extractZipFiles } = require('../src/zip')
const { buildOtzplugin } = require('../src/zipWriter')
const { analyzeReachability } = require('../src/reachability')
const { resolveUpdateFields, imageContentType, StoreClient } = require('../src/publish')
const { MARKER, buildCommentBody, replaceSummaryComment } = require('../src/prComment')
const {
  buildFallbackSpec,
  mergeWithFallback,
  parseSpecJson,
} = require('../src/apiSpec')
const vendoredSpec = require('../src/spec.json')
const { isBlockedSettingKey } = require('../src/knownApi')

const spec = mergeWithFallback(buildFallbackSpec())
const opts = { spec, appVersion: null, skipAppVersion: true }
const fx = (name) => path.join(__dirname, 'fixtures', name)

let passed = 0
let failed = 0
const pending = [] // טסטים אסינכרוניים — הסיכום ממתין להם לפני היציאה
function test(name, fn) {
  const pass = () => {
    passed++
    process.stdout.write(`  ✓ ${name}\n`)
  }
  const fail = (e) => {
    failed++
    process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`)
  }
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      pending.push(result.then(pass, fail))
    } else {
      pass()
    }
  } catch (e) {
    fail(e)
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

// חריג פס הכותרת: DESIGN_GUIDE מחייב שם px קשיחים (שלא יתנפחו עם גופן
// הקריאה), ולכן font-size ב-px מותר בסלקטור פס הכותרת בלבד.
test('font-size in px is allowed inside the top bar selector', () => {
  const files = new Map([['style.css', 'header.topbar .brand { font-size: 16px; }']])
  const d = checkDesignCompliance(files)
  assert.ok(
    !d.violations.some((v) => v.includes('font-size')),
    `unexpected font-size violation: ${d.violations.join(' | ')}`
  )
})

test('font-size in px is still blocked outside the top bar', () => {
  const files = new Map([['style.css', '.card { font-size: 16px; }']])
  const d = checkDesignCompliance(files)
  assert.ok(
    d.violations.some((v) => v.includes('font-size')),
    'expected a font-size violation outside the top bar'
  )
})

test('top-bar exception does not leak to the next rule', () => {
  const files = new Map([
    ['style.css', '.topbar { font-size: 16px; } .card { font-size: 18px; }'],
  ])
  const d = checkDesignCompliance(files)
  assert.ok(
    d.violations.some((v) => v.includes('font-size')),
    'expected the non-topbar rule to still be flagged'
  )
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

test('blocking error when name exceeds 14 chars or description exceeds 150', () => {
  const base = { id: 'com.test.limits', name: 'ok', version: '1.0.0', entrypoint: 'index.html' }
  const validPerms = new Set()

  const longName = validateManifestFields({
    manifest: buildManifest({ ...base, name: 'name-is-way-too-long' }),
    validPermissions: validPerms,
  })
  assert.ok(longName.some((e) => e.includes('שם התוסף חייב להכיל לכל היותר 14 תווים')), 'missing name-length error')

  const longDesc = validateManifestFields({
    manifest: buildManifest({ ...base, description: 'א'.repeat(151) }),
    validPermissions: validPerms,
  })
  assert.ok(longDesc.some((e) => e.includes('תיאור קצר חייב להכיל לכל היותר 150 תווים')), 'missing description-length error')

  const titleMismatch = validateManifestFields({
    manifest: buildManifest({ ...base, name: 'שם', contributes: { toolTab: { title: 'כותרת אחרת' } } }),
    validPermissions: validPerms,
  })
  assert.ok(titleMismatch.some((e) => e.includes('השמות חייבים להיות זהים')), 'missing title!==name error')

  const emptyTitle = validateManifestFields({
    manifest: buildManifest({ ...base, name: 'שם', contributes: { toolTab: { title: '' } } }),
    validPermissions: validPerms,
  })
  assert.ok(emptyTitle.some((e) => e.includes('השמות חייבים להיות זהים')), 'empty title must be blocked')

  const ok = validateManifestFields({
    manifest: buildManifest({ ...base, name: 'בסדר גמור', description: 'א'.repeat(150), contributes: { toolTab: { title: 'בסדר גמור' } } }),
    validPermissions: validPerms,
  })
  assert.deepStrictEqual(ok, [], `unexpected errors: ${ok.join(' | ')}`)
})

test('stability חייב להיות stable/beta/experimental (חסר → ברירת מחדל stable)', () => {
  const base = { id: 'com.test.stability', name: 'ok', version: '1.0.0', entrypoint: 'index.html' }
  const validPerms = new Set()

  const bad = validateManifestFields({
    manifest: buildManifest({ ...base, stability: 'alpha' }),
    validPermissions: validPerms,
  })
  assert.ok(bad.some((e) => e.includes('stability')), 'missing stability error')

  const missing = validateManifestFields({
    manifest: buildManifest({ ...base }),
    validPermissions: validPerms,
  })
  assert.ok(!missing.some((e) => e.includes('stability')), 'missing stability must default to stable')

  for (const value of ['stable', 'beta', 'experimental']) {
    const r = validateManifestFields({
      manifest: buildManifest({ ...base, stability: value }),
      validPermissions: validPerms,
    })
    assert.ok(!r.some((e) => e.includes('stability')), `stability=${value} should pass`)
  }
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

test('declared background entrypoint that exists passes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.bg', name: 'bg', version: '1.0.0',
    entrypoint: 'index.html',
    contributes: { background: { entrypoint: 'background.html' } },
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  fs.writeFileSync(path.join(tmp, 'background.html'), '<html dir="rtl" lang="he"></html>')
  const r = validateSource({ kind: 'dir', root: tmp }, opts)
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
})

test('declared-but-missing background entrypoint is a blocking error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.bg2', name: 'bg', version: '1.0.0',
    entrypoint: 'index.html',
    contributes: { background: { entrypoint: 'background.html' } },
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  const r = validateSource({ kind: 'dir', root: tmp }, opts)
  assert.ok(
    r.errors.some((e) => e.includes('קובץ הרקע background.html לא נמצא')),
    r.errors.join(' | ')
  )
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
      minAppVersion: '0.9.89',
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

test('reachability warns on a local asset the packaging rules dropped', () => {
  const allNames = ['manifest.json', 'index.html', 'app.js']
  const texts = new Map([
    ['manifest.json', '{}'],
    ['index.html', '<html><script src="app.js"></script></html>'],
    ['app.js', "fetch('help.md').then(r => r.text()); fetch('https://x.example/api')"],
  ])
  const manifest = { entrypoint: 'index.html', raw: {} }
  const { missing } = analyzeReachability({ allNames, texts, manifest })
  assert.ok(missing.some((m) => m.includes('help.md')), `expected help.md, got ${missing.join(', ')}`)
  assert.ok(!missing.some((m) => m.includes('x.example')), 'external URLs must not be flagged')
})

test('a bare loopback host is accepted in network.allowlist (as Otzaria accepts it)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.y', name: 'y', version: '1.0.0', entrypoint: 'index.html',
    minAppVersion: '0.9.95', permissions: ['network.access'],
    network: { enabled: true, allowlist: ['127.0.0.1', 'localhost', 'https://api.example.com'] },
    contributes: { toolTab: { title: 'y' } },
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  const report = validateSource({ kind: 'dir', root: tmp }, opts)
  const complaints = [...report.errors, ...report.warnings]
  assert.ok(
    !complaints.some((e) => e.includes('network.allowlist')),
    `loopback host flagged: ${complaints.join(' | ')}`,
  )
})

test('a ! line re-includes a metadata file and a screenshots asset', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, id: 'com.x.y', name: 'y', version: '1.0.0', entrypoint: 'index.html',
  }))
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html dir="rtl" lang="he"></html>')
  fs.writeFileSync(path.join(tmp, 'help.md'), '# help')
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# log')
  fs.mkdirSync(path.join(tmp, 'screenshots'))
  fs.writeFileSync(path.join(tmp, 'screenshots', 'logo.png'), 'x')
  fs.writeFileSync(path.join(tmp, 'screenshots', 'store-1.png'), 'x')
  fs.mkdirSync(path.join(tmp, '.well-known'))
  fs.writeFileSync(path.join(tmp, '.well-known', 'keys.json'), '{}')
  fs.writeFileSync(path.join(tmp, '.otzignore'),
    '!help.md\n!screenshots/logo.png\n!.well-known/keys.json\n')
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')
  const res = buildOtzplugin(tmp, out)
  const names = [...extractZipFiles(fs.readFileSync(out)).keys()]
  assert.ok(names.includes('help.md'), '!help.md should override the metadata exclusion')
  assert.ok(names.includes('screenshots/logo.png'), '! should reach into screenshots/')
  assert.ok(names.includes('.well-known/keys.json'), '! should reach into a hidden dir')
  assert.ok(!names.includes('CHANGELOG.md'), 'un-negated .md stays excluded')
  assert.ok(!names.includes('screenshots/store-1.png'), 'un-negated asset stays excluded')
  assert.ok(!names.includes('.otzignore'), '.otzignore itself is never packed')
  assert.ok(res.metadataExcluded.includes('CHANGELOG.md'), 'metadata exclusions are reported')
  assert.ok(res.metadataExcluded.includes('screenshots/store-1.png'))
})

test('zipWriter rejects an entrypoint that would not be packed', () => {
  const mk = (entrypoint, extra) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otz-'))
    fs.writeFileSync(path.join(tmp, 'manifest.json'), '{}')
    const f = path.join(tmp, entrypoint)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'x')
    if (extra) fs.writeFileSync(path.join(tmp, '.otzignore'), extra)
    return tmp
  }
  const out = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')

  assert.throws(
    () => buildOtzplugin(mk('index.md'), out(), { entrypoint: 'index.md' }),
    /מטא-דאטה/,
    'a .md entrypoint must fail loudly',
  )
  assert.throws(
    () => buildOtzplugin(mk('app/index.html', 'app/\n'), out(), { entrypoint: 'app/index.html' }),
    /\.otzignore/,
    'an .otzignore-excluded entrypoint must fail loudly',
  )
  assert.throws(
    () => buildOtzplugin(mk('bg/worker.html', 'bg/\n'), out(), {
      entrypoint: 'bg/worker.html', backgroundEntrypoint: 'bg/worker.html',
    }),
    /\.otzignore/,
    'an excluded background entrypoint must fail loudly',
  )
  // A `!` line brings the metadata entrypoint back — no throw.
  const okRoot = mk('index.md', '!index.md\n')
  const okOut = out()
  buildOtzplugin(okRoot, okOut, { entrypoint: 'index.md' })
  assert.ok([...extractZipFiles(fs.readFileSync(okOut)).keys()].includes('index.md'))
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

test('publish edit targets the owner route, with the admin route as fallback', () => {
  // /api/admin/* נחסם ב-middleware של האתר לכל מי שאינו מנהל, עוד לפני בדיקת
  // הבעלות — מפתח רגיל חייב לעבור דרך נתיב הבעלים /api/plugins/[id]/edit.
  // מנהל שאינו הבעלים נדחה בנתיב הבעלים ולכן קיים נתיב אדמין כ-fallback.
  const client = new StoreClient('https://otzaria.org')
  assert.strictEqual(client.editUrl('abc123'), 'https://otzaria.org/api/plugins/abc123/edit')
  assert.strictEqual(client.adminEditUrl('abc123'), 'https://otzaria.org/api/admin/plugins/abc123/edit')
})

test('network-mocked scenarios (publish fallback + pr comment)', async () => {
  // כל התרחישים שדורשים מוק גלובלי של fetch מרוכזים בטסט אחד, סדרתית —
  // טסטים אסינכרוניים רצים במקביל, ומוק גלובלי בכמה טסטים נפרדים היה דורס
  // את עצמו.
  const origFetch = global.fetch
  try {
    // מנהל שאינו הבעלים: נתיב הבעלים 403, נתיב האדמין זמין → ממשיכים דרכו.
    const calls = []
    global.fetch = async (url) => {
      calls.push(String(url))
      const isAdminRoute = String(url).includes('/api/admin/')
      return {
        ok: isAdminRoute,
        status: isAdminRoute ? 200 : 403,
        headers: { getSetCookie: () => [] },
        json: async () => ({ version: '1.0.0' }),
      }
    }
    const client = new StoreClient('https://otzaria.org')
    // הגרסה בחנות זהה לגרסת המניפסט → אחרי ה-fallback המוצלח נקבל דילוג נקי,
    // בלי להגיע ל-PUT (שדורש קובץ אמיתי).
    const res = await client.edit({ id: 'abc123', pluginFile: 'x', manifest: { version: '1.0.0' } })
    assert.strictEqual(res.skipped, true)
    assert.ok(calls[0].includes('/api/plugins/abc123/edit'), 'owner route tried first')
    assert.ok(calls[1].includes('/api/admin/plugins/abc123/edit'), 'admin route tried on 403')

    // לא בעלים וגם לא מנהל: שני הנתיבים 403 → שגיאת בעלות.
    global.fetch = async () => ({
      ok: false,
      status: 403,
      headers: { getSetCookie: () => [] },
      json: async () => ({}),
    })
    await assert.rejects(
      new StoreClient('https://otzaria.org').edit({ id: 'abc123', pluginFile: 'x', manifest: { version: '1.0.0' } }),
      /אין בעלות על התוסף/
    )

    // pr comment: תגובה קודמת עם ה-MARKER נמחקת (השנייה, ללא MARKER, נשארת),
    // ואז נוצרת תגובה חדשה.
    const prCalls = []
    global.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET'
      prCalls.push({ url: String(url), method })
      if (String(url).endsWith('/comments?per_page=100')) {
        return {
          ok: true,
          json: async () => [
            { id: 1, body: `${MARKER}\nold summary` },
            { id: 2, body: 'unrelated human comment' },
          ],
        }
      }
      if (method === 'DELETE') return { ok: true, status: 204 }
      if (method === 'POST') return { ok: true, json: async () => ({ id: 3 }) }
      throw new Error(`unexpected request: ${url}`)
    }
    await replaceSummaryComment({
      token: 't', apiBase: 'https://api.github.com/repos/o/r', prNumber: 5, markdown: '| x |', runUrl: '',
    })
    const deleted = prCalls.filter((c) => c.method === 'DELETE').map((c) => c.url)
    assert.deepStrictEqual(deleted, ['https://api.github.com/repos/o/r/issues/comments/1'])
    assert.strictEqual(prCalls.filter((c) => c.method === 'POST').length, 1)

    // pr comment: בלי תגובה קודמת עם MARKER — GET ואז POST בלבד, בלי DELETE.
    const prMethods = []
    global.fetch = async (url, opts) => {
      prMethods.push((opts && opts.method) || 'GET')
      if (String(url).endsWith('/comments?per_page=100')) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => ({ id: 9 }) }
    }
    await replaceSummaryComment({
      token: 't', apiBase: 'https://api.github.com/repos/o/r', prNumber: 5, markdown: '| x |', runUrl: '',
    })
    assert.deepStrictEqual(prMethods, ['GET', 'POST'])

    // pr comment: כשל HTTP מייצר שגיאה קריאה (כולל גוף התשובה).
    global.fetch = async () => ({ ok: false, status: 403, text: async () => 'Resource not accessible' })
    await assert.rejects(
      replaceSummaryComment({
        token: 't', apiBase: 'https://api.github.com/repos/o/r', prNumber: 5, markdown: '| x |', runUrl: '',
      }),
      /HTTP 403.*Resource not accessible/
    )
  } finally {
    global.fetch = origFetch
  }
})

test('pr comment body embeds the marker and an optional run link', () => {
  assert.ok(buildCommentBody('| a | b |', '').startsWith(MARKER))
  assert.ok(!buildCommentBody('| a | b |', '').includes('הרצה מלאה'))
  assert.ok(buildCommentBody('| a | b |', 'https://x/runs/1').includes('[הרצה מלאה](https://x/runs/1)'))
})

test('parseSpecJson קורא את המפרט המחולל ומשלב methods שאינם מתועדים', () => {
  const parsed = parseSpecJson(JSON.stringify({
    schemaVersion: 1,
    permissions: ['app.info.read', 'library.books.read', 'notes.read', 'notes.write', 'ui.feedback'],
    apiMethods: [
      'app.getInfo', 'app.getTheme', 'library.findBooks', 'notes.list', 'notes.add',
      'notes.update', 'notes.delete', 'ui.showMessage', 'storage.get', 'storage.set',
    ],
    undocumentedApiMethods: ['plugin.listInstalled'],
    methodPermissions: { 'library.findBooks': 'library.books.read' },
    methodMinVersions: { 'app.getInfo': '0.9.89', 'library.findBooks': '0.9.89' },
    events: ['theme.changed'],
    settings: { policy: 'blocklist', blockedSubstrings: ['path'], blockedPrefixes: [], blockedKeys: ['key-tabs'] },
    manifest: { stability: ['stable'] },
    versions: { whenCondition: '0.9.97' },
  }))
  assert.strictEqual(parsed.source, 'remote')
  assert.ok(parsed.apiMethods.has('app.getInfo'))
  // methods שאינם מתועדים נכללים כדי שלא יסומנו כ"לא מוכרים"
  assert.ok(parsed.apiMethods.has('plugin.listInstalled'))
  assert.ok(parsed.permissions.has('library.books.read'))
  assert.ok(parsed.events.has('theme.changed'))
  assert.strictEqual(parsed.methodMinVersions.get('app.getInfo'), '0.9.89')
  assert.strictEqual(parsed.methodPermissions.get('library.findBooks'), 'library.books.read')
})

test('parseSpecJson דוחה מפרט קטוע, סכימה לא נתמכת, ושדה חסר', () => {
  const valid = {
    schemaVersion: 1,
    permissions: ['a.b', 'a.c', 'a.d', 'a.e', 'a.f'],
    apiMethods: Array.from({ length: 10 }, (_, i) => `n.m${i}`),
    undocumentedApiMethods: [],
    methodPermissions: {},
    methodMinVersions: {},
    events: [],
    settings: { policy: 'blocklist', blockedSubstrings: [], blockedPrefixes: [], blockedKeys: [] },
    manifest: { stability: ['stable'] },
    versions: { whenCondition: '0.9.97' },
  }
  assert.ok(parseSpecJson(JSON.stringify(valid)))
  assert.throws(() => parseSpecJson(JSON.stringify({ ...valid, schemaVersion: 99 })), /schemaVersion/)
  assert.throws(() => parseSpecJson(JSON.stringify({ ...valid, apiMethods: ['a.b'] })), /malformed/)
  const noEvents = { ...valid }
  delete noEvents.events
  assert.throws(() => parseSpecJson(JSON.stringify(noEvents)), /events/)
  assert.throws(() => parseSpecJson('not json'), /./)
})

test('העותק המצורף src/spec.json הוא מפרט תקף, והרצפה נגזרת ממנו', () => {
  const parsed = parseSpecJson(vendoredSpec)
  const floor = buildFallbackSpec()
  assert.strictEqual(floor.source, 'vendored')
  for (const method of parsed.apiMethods) {
    if (vendoredSpec.undocumentedApiMethods.includes(method)) continue
    assert.ok(floor.apiMethods.has(method), `method חסר ברצפה: ${method}`)
  }
  for (const permission of parsed.permissions) {
    assert.ok(floor.permissions.has(permission), `הרשאה חסרה ברצפה: ${permission}`)
  }
  // כל method מתועד נושא גרסת מינימום — אחרת אכיפת הגרסאות נעלמת בשקט
  for (const method of vendoredSpec.apiMethods) {
    assert.ok(floor.methodMinVersions.has(method), `גרסה חסרה: ${method}`)
  }
})

test('mergeWithFallback: המסמך מוסיף מיפויים אך אינו דורס את המפה המובנית', () => {
  const merged = mergeWithFallback({
    permissions: new Set(['library.books.read']),
    apiMethods: new Set(['plugin.openOther']),
    methodMinVersions: new Map(),
    methodPermissions: new Map([
      ['plugin.openOther', 'plugin.open_other'],
      // ענף dev יכול לפגר אחרי האפליקציה: כאן ההרשאה עוד לא פוצלה
      ['ui.pickFolder', 'ui.feedback'],
    ]),
    events: new Set(),
    source: 'remote',
  })
  assert.strictEqual(merged.methodPermissions.get('plugin.openOther'), 'plugin.open_other')
  // רשומה ותיקה שאינה במסמך שנמסר — נשמרת מהרצפה המובנית
  assert.strictEqual(merged.methodPermissions.get('app.openUrl'), 'app.open_url')
  // מסמך מפגר אינו מחזיר את האזהרה להרשאה הישנה
  assert.strictEqual(merged.methodPermissions.get('ui.pickFolder'), 'fs.folder_access')
})

function versionFixtureZip({ minAppVersion, method, permission }) {
  const buf = makeStoredZip({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.ver', name: 'ver', version: '1.0.0',
      minAppVersion, entrypoint: 'index.js', permissions: [permission],
    }),
    'index.js': `Otzaria.call('${method}', {})`,
  })
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')
  fs.writeFileSync(tmp, buf)
  return tmp
}

test('blocking error when a plugin uses an API newer than its minAppVersion', () => {
  const tmp = versionFixtureZip({
    minAppVersion: '0.9.89', method: 'shortcut.create', permission: 'ui.create_shortcut',
  })
  const r = validateSource({ kind: 'zip', file: tmp }, opts)
  assert.ok(
    r.errors.some((e) => e.includes('shortcut.create') && e.includes('0.9.94') && e.includes('0.9.89')),
    'expected version error, got: ' + r.errors.join(' | ')
  )
})

test('no version error when minAppVersion is high enough', () => {
  const tmp = versionFixtureZip({
    minAppVersion: '0.9.94', method: 'shortcut.create', permission: 'ui.create_shortcut',
  })
  const r = validateSource({ kind: 'zip', file: tmp }, opts)
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
})

function warningsForZip(files) {
  const buf = makeStoredZip(files)
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'otz-')), 'p.otzplugin')
  fs.writeFileSync(tmp, buf)
  return validateSource({ kind: 'zip', file: tmp }, opts)
}

test('lifecycle events (suspended/resumed/page_opened) are known — no unknown-event warning', () => {
  const r = warningsForZip({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.lc', name: 'lc', version: '1.0.0',
      minAppVersion: '0.9.96', entrypoint: 'index.js', permissions: [],
    }),
    'index.js': [
      "Otzaria.on('plugin.suspended', () => {})",
      "Otzaria.on('plugin.resumed', () => {})",
      "Otzaria.on('plugin.page_opened', () => {})",
    ].join('\n'),
  })
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
  assert.ok(
    !r.warnings.some((w) => w.includes('רישום ל-event לא מוכר')),
    'unexpected unknown-event warning: ' + r.warnings.join(' | ')
  )
})

test('network.localhost satisfies network.fetch permission cross-check', () => {
  const files = (permissions) => ({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.net', name: 'net', version: '1.0.0',
      minAppVersion: '0.9.96', entrypoint: 'index.js', permissions,
      network: { allowlist: ['127.0.0.1'] },
    }),
    'index.js': "Otzaria.call('network.fetch', { url: 'http://127.0.0.1:1234' })",
  })
  const withLocalhost = warningsForZip(files(['network.localhost']))
  assert.ok(
    !withLocalhost.warnings.some((w) => w.includes('network.access')),
    'network.localhost must satisfy the check: ' + withLocalhost.warnings.join(' | ')
  )
  const withoutAny = warningsForZip(files([]))
  assert.ok(
    withoutAny.warnings.some((w) => w.includes('network.fetch') && w.includes('network.access')),
    'missing-permission warning expected: ' + withoutAny.warnings.join(' | ')
  )
})

test('ui.pickFolder without fs.folder_access emits a missing-permission warning', () => {
  const files = (permissions, minAppVersion = '0.9.96') => ({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.pf', name: 'pf', version: '1.0.0',
      minAppVersion, entrypoint: 'index.js', permissions,
    }),
    'index.js': "Otzaria.call('ui.pickFolder', {})",
  })
  const missing = warningsForZip(files([]))
  assert.ok(
    missing.warnings.some((w) => w.includes('ui.pickFolder') && w.includes('fs.folder_access')),
    'missing-permission warning expected: ' + missing.warnings.join(' | ')
  )
  // הצהרה ותיקה על ui.feedback עדיין מכסה את pickFolder (alias)
  const legacy = warningsForZip(files(['ui.feedback']))
  assert.ok(
    !legacy.warnings.some((w) => w.includes('ui.pickFolder')),
    'unexpected warning: ' + legacy.warnings.join(' | ')
  )
  const explicit = warningsForZip(files(['fs.folder_access'], '0.9.97'))
  assert.deepStrictEqual(explicit.errors, [], explicit.errors.join(' | '))
  assert.ok(
    !explicit.warnings.some((w) => w.includes('ui.pickFolder')),
    'unexpected warning: ' + explicit.warnings.join(' | ')
  )
})

test('baseline APIs need no declaration; declaring one warns (deprecation)', () => {
  const files = (permissions) => ({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.base', name: 'base', version: '1.0.0',
      minAppVersion: '0.9.96', entrypoint: 'index.js', permissions,
    }),
    'index.js': [
      "Otzaria.call('storage.get', {})",
      "Otzaria.call('ui.showMessage', {})",
      "Otzaria.call('app.getInfo', {})",
      "Otzaria.call('notifications.showInApp', {})",
      "Otzaria.on('theme.changed', () => {})",
    ].join('\n'),
  })
  const undeclared = warningsForZip(files([]))
  assert.ok(
    !undeclared.warnings.some((w) => w.includes('אך לא ביקש')),
    'baseline APIs must not warn: ' + undeclared.warnings.join(' | ')
  )
  assert.ok(
    !undeclared.warnings.some((w) => w.includes('theme.changed')),
    'baseline event must not warn: ' + undeclared.warnings.join(' | ')
  )
  const declared = warningsForZip(files(['plugin.storage.read', 'ui.feedback']))
  assert.ok(
    declared.warnings.some((w) => w.includes('plugin.storage.read') && w.includes('ניתנת כיום אוטומטית')),
    'deprecation warning expected: ' + declared.warnings.join(' | ')
  )
})

test('declaring fs.folder_access requires minAppVersion 0.9.97', () => {
  const files = (minAppVersion) => ({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.fa', name: 'fa', version: '1.0.0',
      minAppVersion, entrypoint: 'index.js', permissions: ['fs.folder_access'],
    }),
    'index.js': "Otzaria.call('ui.pickFolder', {})",
  })
  const tooOld = warningsForZip(files('0.9.94'))
  assert.ok(
    tooOld.errors.some((e) => e.includes('fs.folder_access') && e.includes('0.9.97')),
    'blocking version error expected: ' + tooOld.errors.join(' | ')
  )
  const ok = warningsForZip(files('0.9.97'))
  assert.deepStrictEqual(ok.errors, [], ok.errors.join(' | '))
})

// ---- contributes.startup `when` ---------------------------------------------

// תוסף מינימלי עם contributes.startup — ללא when כלל אין מה לבדוק, ולכן כל
// הבדיקות שלהלן נבדלות רק בסעיף startup ובגרסת המינימום.
function whenPlugin(startup, minAppVersion = '0.9.97') {
  return warningsForZip({
    'manifest.json': JSON.stringify({
      schemaVersion: 1, id: 'com.example.when', name: 'when', version: '1.0.0',
      minAppVersion, entrypoint: 'index.js', permissions: [],
      contributes: { startup },
    }),
    'index.js': '// no api usage',
  })
}

const toolbarWhen = (when) => ({ toolbarItems: [{ id: 'a', label: 'כלי', when }] })

test('when תקין על תרומות ועל activationEvents עובר בלי שגיאות', () => {
  const r = whenPlugin({
    toolbarItems: [{
      id: 'a', label: 'כלי',
      when: { all: [
        { setting: { key: 'key-dark-mode', equals: true } },
        { not: { storage: { key: 'hidden', exists: true } } },
        { any: [
          { setting: { key: 'key-font-size', notEquals: 25 } },
          { storage: { key: 'mode', equals: 'full' } },
        ] },
      ] },
    }],
    contextMenuItems: [{ id: 'b', label: 'פריט', when: { storage: { key: 'x', equals: null } } }],
    searchDialogItems: [{ id: 'c', label: 'חיפוש', when: { setting: { key: 'key-settings-language', equals: 'he' } } }],
    activationEvents: [
      'app.startup',
      { topic: 'reader.sectionContentChanged', when: { storage: { key: 'autoSync', equals: true } } },
    ],
  })
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
})

test('עלה עם שני אופרטורים נפסל', () => {
  const r = whenPlugin(toolbarWhen({ setting: { key: 'key-dark-mode', equals: true, exists: true } }))
  assert.ok(
    r.errors.some((e) => e.includes('toolbarItems') && e.includes('exactly one of equals')),
    'expected leaf-operator error: ' + r.errors.join(' | ')
  )
})

test('צומת עם קומבינטור ועלה יחד נפסל (מפתח יחיד לכל צומת)', () => {
  const r = whenPlugin(toolbarWhen({
    setting: { key: 'key-dark-mode', equals: true },
    any: [{ storage: { key: 'x', exists: true } }],
  }))
  assert.ok(
    r.errors.some((e) => e.includes('exactly one of setting, storage, all, any, not')),
    'expected single-key error: ' + r.errors.join(' | ')
  )
})

test('when עמוק מ-5 רמות נפסל', () => {
  let when = { setting: { key: 'key-dark-mode', equals: true } }
  for (let i = 0; i < 5; i++) when = { not: when }
  const r = whenPlugin(toolbarWhen(when))
  assert.ok(
    r.errors.some((e) => e.includes('nested too deeply')),
    'expected depth error: ' + r.errors.join(' | ')
  )
})

test('when עם יותר מ-20 עלים נפסל', () => {
  const leaves = (n) => Array.from({ length: n }, (_, i) => ({ storage: { key: `k${i}`, exists: true } }))
  const r = whenPlugin(toolbarWhen({ all: [{ all: leaves(11) }, { all: leaves(11) }] }))
  assert.ok(
    r.errors.some((e) => e.includes('too many conditions')),
    'expected leaf-count error: ' + r.errors.join(' | ')
  )
})

test('key ריק או ארוך מ-128 תווים נפסל', () => {
  const empty = whenPlugin(toolbarWhen({ storage: { key: '', exists: true } }))
  assert.ok(
    empty.errors.some((e) => e.includes('non-empty string of up to 128')),
    'expected empty-key error: ' + empty.errors.join(' | ')
  )
  const long = whenPlugin(toolbarWhen({ storage: { key: 'k'.repeat(129), exists: true } }))
  assert.ok(
    long.errors.some((e) => e.includes('non-empty string of up to 128')),
    'expected long-key error: ' + long.errors.join(' | ')
  )
})

test('עלה setting על מפתח שאינו זמין לתוספים נפסל', () => {
  // מדיניות blocklist: מפתח שאינו חסום עובר — גם אם אינו מוכר לוולידטור
  const unknown = whenPlugin(toolbarWhen({ setting: { key: 'key-no-such-setting', equals: 1 } }))
  assert.deepStrictEqual(unknown.errors, [], unknown.errors.join(' | '))
  const secret = whenPlugin(toolbarWhen({ setting: { key: 'key-some-secret', equals: 1 } }))
  assert.ok(
    secret.errors.some((e) => e.includes('שאינה זמינה לתוספים') && e.includes('key-some-secret')),
    'expected blocked-substring error: ' + secret.errors.join(' | ')
  )
  // מפתח חסום לקריאה — מוערך כ-false בזמן ריצה, ולכן נפסל כבר כאן
  const blocked = whenPlugin(toolbarWhen({ setting: { key: 'key-library-path', exists: true } }))
  assert.ok(
    blocked.errors.some((e) => e.includes('key-library-path')),
    'expected blocklist error: ' + blocked.errors.join(' | ')
  )
  // אותו מפתח כ-storage הוא מרחב התוסף עצמו — מותר
  const asStorage = whenPlugin(toolbarWhen({ storage: { key: 'key-library-path', exists: true } }))
  assert.deepStrictEqual(asStorage.errors, [], asStorage.errors.join(' | '))
})

test('activationEvents: שדה לא מוכר ("wen") נפסל במקום להתעלם בשקט', () => {
  const r = whenPlugin({
    activationEvents: [{ topic: 'app.startup', wen: { storage: { key: 'x', exists: true } } }],
  })
  assert.ok(
    r.errors.some((e) => e.includes('שדה לא מוכר') && e.includes('wen')),
    'expected unknown-field error: ' + r.errors.join(' | ')
  )
})

test('when דורש minAppVersion 0.9.97', () => {
  const tooOld = whenPlugin(toolbarWhen({ setting: { key: 'key-dark-mode', equals: true } }), '0.9.96')
  assert.ok(
    tooOld.errors.some((e) => e.includes('תנאי when') && e.includes('0.9.97') && e.includes('0.9.96')),
    'expected version error: ' + tooOld.errors.join(' | ')
  )
})

test('contributes.startup בלי when אינו נוגע בתוסף קיים', () => {
  const r = whenPlugin({
    toolbarItems: [{ id: 'a', label: 'כלי' }],
    activationEvents: ['app.startup', 'reader.sectionContentChanged'],
    keepAlive: true,
  }, '0.9.96')
  assert.deepStrictEqual(r.errors, [], r.errors.join(' | '))
})

test('מדיניות ההגדרות היא blocklist הנגזרת מהמפרט', () => {
  // מה שאינו חסום — קריא, גם מפתח שהוולידטור לא מכיר
  assert.ok(!isBlockedSettingKey('key-dark-mode'))
  assert.ok(!isBlockedSettingKey('key-brand-new-setting'))
  // חלק-מפתח חסום תופס גם הגדרה שלא נרשמה מעולם
  assert.ok(isBlockedSettingKey('key-library-path'))
  assert.ok(isBlockedSettingKey('key-some-new-secret'))
  assert.ok(isBlockedSettingKey('key-google-calendar-anything'))
  assert.ok(isBlockedSettingKey('sz:progress'))
  assert.ok(isBlockedSettingKey(''))
  assert.ok(isBlockedSettingKey('  KEY-TABS  '), 'נירמול רווחים/רישיות חסר')
  // כל מה שהמפרט מסמן כחסום — אכן חסום
  for (const key of vendoredSpec.settings.blockedKeys) {
    assert.ok(isBlockedSettingKey(key), `מפתח חסום דלף: ${key}`)
  }
})

// ---- Public package API ------------------------------------------------------
// החנות (Otzaria_Website) צורכת את החבילה דרך src/index.js. הבדיקות כאן הן
// חוזה: שבירתן שוברת את החנות בבנייה הבאה, כי היא מרעננת את #v1 בכל בנייה.

test('src/index.js הוא API טהור ואינו מריץ את ה-Action', () => {
  const api = require('../src/index')
  for (const name of [
    'SPEC', 'getApiSpec', 'parseSpecJson', 'buildFallbackSpec', 'mergeWithFallback',
    'buildManifest', 'validateManifestFields', 'MANIFEST_RULES', 'ALL_MANIFEST_RULES',
    'compareCoreVersions', 'validateWhenConditions', 'validateStartupWhenConditions',
    'analyzeApiUsage', 'runExtendedValidation', 'checkDesignCompliance',
    'isCodeLikeFile', 'isStyleLikeFile', 'analyzeReachability', 'validateSource',
    'extractZipFiles', 'isBlockedSettingKey',
  ]) {
    assert.ok(api[name] !== undefined, `חסר בייצוא הציבורי: ${name}`)
  }
  assert.equal(api.SPEC.schemaVersion, 1)
  // המפרט נוסע בתוך החבילה — src/spec.json תחת files
  assert.ok(require('../package.json').files.includes('src'))
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'spec.json')))
})

test('buildManifest lenient: שדה חסר אינו זורק ומסומן ב-declared', () => {
  const { buildManifest } = require('../src/manifestValidator')
  assert.throws(() => buildManifest({ id: 'a' }))
  const lenient = buildManifest({ id: 'a' }, { lenient: true })
  assert.equal(lenient.name, '')
  assert.equal(lenient.declared.name, false)
  assert.equal(lenient.toolTabTitle, '')
  // כלל הכותרת מדלג על מניפסט בלי name — כך החנות לא מדווחת על שדה שלא נכתב
  assert.deepEqual(
    validateManifestFields({ manifest: lenient, validPermissions: spec.permissions, rules: ['toolTabTitle'] }),
    []
  )
})

test('validateManifestFields עם תת-קבוצת כללים מריץ אותם בלבד', () => {
  const manifest = buildManifest({
    id: 'BAD ID', name: 'ש', version: 'not-semver', entrypoint: 'index.html',
    stability: 'nope',
  })
  const all = validateManifestFields({ manifest, validPermissions: spec.permissions })
  assert.ok(all.length >= 3)
  const subset = validateManifestFields({
    manifest, validPermissions: spec.permissions, rules: ['name', 'description'],
  })
  assert.deepEqual(subset, [])
  assert.throws(() => validateManifestFields({
    manifest, validPermissions: spec.permissions, rules: ['noSuchRule'],
  }), /unknown manifest rule/)
})

test('הצהרה על קריאת API ב-permissions מקבלת הודעה לפי סוג הקריאה', () => {
  const base = { id: 'com.test.perms', name: 'ok', version: '1.0.0', entrypoint: 'index.html' }
  const run = (perm) => validateManifestFields({
    manifest: buildManifest({ ...base, permissions: [perm] }),
    validPermissions: spec.permissions,
    methodPermissions: spec.methodPermissions,
    apiMethods: spec.apiMethods,
    rules: ['permissions'],
  })

  assert.deepEqual(run('feedback.report'), [
    '"feedback.report" היא קריאת API ולא שם של הרשאה, והיא אינה דורשת הרשאה ' +
      'במניפסט. הסירו אותה מ-permissions — הקריאה עצמה תמשיך לעבוד',
  ])
  assert.ok(run('network.fetch')[0].includes('האם התכוונת ל-"network.access"?'))
  assert.ok(run('made.up.permission')[0].includes('הרשאה לא חוקית שנדרשת על ידי התוסף'))
})

test('analyzeApiUsage מחזיר ממצאים מקובצים ובלי חומרה, וקורא Buffer', () => {
  const { analyzeApiUsage } = require('../src/extendedValidator')
  const manifest = buildManifest({
    id: 'x.y', name: 'בדיקה', version: '1.0.0', entrypoint: 'index.html',
    minAppVersion: '0.9.97', permissions: ['app.info.read'],
  })
  const files = new Map([
    ['main.js', Buffer.from("Otzaria.call('notes.add', {})\nOtzaria.call('no.suchApi', {})", 'utf8')],
  ])
  const usage = analyzeApiUsage({ manifest, files, spec })
  assert.deepEqual(usage.unknownMethods.map((f) => f.method), ['no.suchApi'])
  assert.deepEqual(usage.missingPermissions.map((f) => f.permission), ['notes.write'])
  // הרשאת בסיס מוצהרת היא דלי נפרד — החנות ממפה אותו ל-advisory, ה-Action לאזהרה
  assert.deepEqual(usage.baselinePermissions.map((f) => f.permission), ['app.info.read'])
  assert.deepEqual(usage.permissionVersionErrors, [])
  assert.deepEqual(usage.methodVersionErrors, [])
})

test('checkDesignCompliance קורא גם Buffer וגם מחרוזת', () => {
  const html = '<!doctype html><html dir="rtl" lang="he"><style>a{color:var(--color-text)}</style></html>'
  const fromText = checkDesignCompliance(new Map([['a.html', html]]))
  const fromBuffer = checkDesignCompliance(new Map([['a.html', Buffer.from(html, 'utf8')]]))
  assert.deepEqual(fromBuffer, fromText)
  assert.equal(fromText.compliant, true)
})

Promise.all(pending).then(() => {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
})
