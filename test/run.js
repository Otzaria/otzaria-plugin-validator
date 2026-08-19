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
const {
  buildFallbackSpec,
  mergeWithFallback,
  parseApiReferenceMarkdown,
  parseSettingReadKeys,
} = require('../src/apiSpec')

const spec = mergeWithFallback(buildFallbackSpec())
const opts = { spec, appVersion: null, skipAppVersion: true }

// parseApiReferenceMarkdown דוחה מסמך דל מדי (הגנה מפני אחזור חלקי); זנב זה
// מספק את המינימום כדי שבדיקות הפרסור יוכלו להתמקד בשורות שהן בודקות.
const MIN_SPEC_TAIL = [
  '### `storage.get`', '### `storage.set`', '### `storage.remove`',
  '### `storage.list`', '### `settings.get`', '### `history.list`',
  '### `notes.add`', '### `notes.update`', '### `notes.delete`',
  '### `reader.openBook`', '### `search.fullText`', '### `calendar.getEvents`',
  '`app.info.read` `notes.read` `notes.write` `reader.open` `ui.feedback` `history.read`',
].join('\n')
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

test('publish edit falls back to the admin route on owner-route 403', async () => {
  // שני התרחישים בטסט אחד, סדרתית — טסטים אסינכרוניים רצים במקביל ומוק
  // גלובלי של fetch בשני טסטים נפרדים היה דורס את עצמו.
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
  } finally {
    global.fetch = origFetch
  }
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
    '| `app.getInfo` | 0.9.89 |',
    '| `shortcut.create` | 0.9.94 |',
  ].join('\n')
  const parsed = parseApiReferenceMarkdown(md)
  assert.ok(parsed.apiMethods.has('app.getInfo'))
  assert.ok(parsed.apiMethods.has('library.findBooks'))
  assert.ok(parsed.permissions.has('app.info.read'))
  assert.ok(parsed.permissions.has('events.subscribe:settings.changed'))
  assert.ok(parsed.events.has('theme.changed'))
  assert.strictEqual(parsed.methodMinVersions.get('app.getInfo'), '0.9.89')
  assert.strictEqual(parsed.methodMinVersions.get('shortcut.create'), '0.9.94')
})

test('method → permission נגזר מהמסמך: שורה רגילה, "נדרשת", ונספח מגרסה', () => {
  const md = [
    '## `library.*`',
    '### `library.findBooks`',
    '**הרשאה:** `library.books.read`',
    '### `library.getBookContent`',
    '**הרשאה נדרשת:** `library.content.read`',
    '### `plugin.openOther`',
    '**הרשאה:** `plugin.open_other` | **מגרסה:** 0.9.97',
    '### `calendar.getCities`',
    '**הרשאה:** `calendar.read` · **מגרסה:** 0.9.97',
    '### `network.fetch`',
    '**הרשאה:** `network.access` (או `network.localhost` ליעד מקומי)',
  ].join('\n')
  const m = parseApiReferenceMarkdown(md + '\n' + MIN_SPEC_TAIL).methodPermissions
  assert.strictEqual(m.get('library.findBooks'), 'library.books.read')
  assert.strictEqual(m.get('library.getBookContent'), 'library.content.read')
  assert.strictEqual(m.get('plugin.openOther'), 'plugin.open_other')
  assert.strictEqual(m.get('calendar.getCities'), 'calendar.read')
  // חלופת localhost נבדקת בנפרד ב-extendedValidator; כאן נלקחת ההרשאה הראשית.
  assert.strictEqual(m.get('network.fetch'), 'network.access')
})

test('"אין הרשאה" אינו מייצר מיפוי, גם כשמוזכרת הרשאה אחרת בהמשך השורה', () => {
  const md = [
    '### `plugin.backgroundDone`',
    '**הרשאה:** אין | **מגרסה:** 0.9.97',
    '### `fs.deleteFile`',
    '**הרשאה:** (אין — מגודר ע"י `ui.pickFolder`)',
    '### `ui.messageClicked` (Event)',
    '**הרשאה:** `ui.feedback`',
  ].join('\n')
  const m = parseApiReferenceMarkdown(md + '\n' + MIN_SPEC_TAIL).methodPermissions
  assert.ok(!m.has('plugin.backgroundDone'))
  assert.ok(!m.has('fs.deleteFile'))
  // כותרת (Event) אינה method שנקרא ב-Otzaria.call
  assert.ok(!m.has('ui.messageClicked'))
})

test('API בלי שורת הרשאה יורש את הצהרת ה-domain שמעליו', () => {
  const md = [
    '## `app.*` - מידע על האפליקציה',
    '**הרשאה נדרשת:** `app.info.read` (למעט `app.getUserEmail`)',
    '### `app.getInfo`',
    'טקסט בלי שורת הרשאה',
    '### `app.getUserEmail`',
    '**הרשאה נדרשת:** `app.user_email.read`',
    '## `notes.*`',
    '### `notes.list`',
    '**הרשאה:** `notes.read`',
  ].join('\n')
  const m = parseApiReferenceMarkdown(md + '\n' + MIN_SPEC_TAIL).methodPermissions
  assert.strictEqual(m.get('app.getInfo'), 'app.info.read')
  // הצהרה מפורשת גוברת על ירושת ה-domain
  assert.strictEqual(m.get('app.getUserEmail'), 'app.user_email.read')
  // ירושה אינה חוצה גבול domain
  assert.strictEqual(m.get('notes.list'), 'notes.read')
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
  const unknown = whenPlugin(toolbarWhen({ setting: { key: 'key-no-such-setting', equals: 1 } }))
  assert.ok(
    unknown.errors.some((e) => e.includes('שאינה זמינה לתוספים') && e.includes('key-no-such-setting')),
    'expected allowlist error: ' + unknown.errors.join(' | ')
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

test('רשימת ההגדרות המורשות נגזרת מהמסמך, ובפורמט שבור נשמרת הרצפה', () => {
  const md = [
    '**מפתחות מורשים לקריאה:**',
    '- `key-dark-mode`',
    '- `key-swatch-color`, `key-dark-swatch-color`',
    '- `key-brand-new-setting`',
    '- `key-hebrew-books-path` — נתיב ספרי HebrewBooks, או `null`/מחרוזת ריקה',
    '  כשלא הוגדר מיקום',
    '',
    '---',
    '- `key-not-in-the-list`',
  ].join('\n')
  const keys = parseSettingReadKeys(md)
  assert.ok(keys.has('key-brand-new-setting'), 'מפתח חדש מהמסמך חסר')
  assert.ok(keys.has('key-dark-swatch-color'), 'מפתח שני באותה שורה חסר')
  assert.ok(!keys.has('key-not-in-the-list'), 'הפרסור לא נעצר בסוף הרשימה')
  assert.strictEqual(parseSettingReadKeys('אין כאן רשימה'), null)

  // הרצפה המובנית נשמרת גם כשהמסמך מפגר, והמסמך רק מרחיב אותה
  const merged = mergeWithFallback({
    permissions: new Set(), apiMethods: new Set(), methodMinVersions: new Map(),
    methodPermissions: new Map(), events: new Set(),
    settingKeys: new Set(['key-brand-new-setting']),
    source: 'remote',
  })
  assert.ok(merged.settingKeys.has('key-brand-new-setting'))
  assert.ok(merged.settingKeys.has('key-line-height'))
})

Promise.all(pending).then(() => {
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
})
