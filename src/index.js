'use strict'

const path = require('path')
const ga = require('./githubActions')
const { getApiSpec, mergeWithFallback, DEFAULT_API_REFERENCE_URL } = require('./apiSpec')
const { discoverPlugins } = require('./discover')
const { validateSource } = require('./validatePlugin')
const { buildOtzplugin } = require('./zipWriter')
const { publishToStore } = require('./publish')

function readInput(name, fallback = '') {
  const key = `INPUT_${name.toUpperCase().replace(/ /g, '_')}`
  const raw = process.env[key]
  return raw === undefined || raw === '' ? fallback : raw
}
function readBool(name, fallback = false) {
  const v = readInput(name, fallback ? 'true' : 'false').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function workspaceRelative(p) {
  const ws = process.env.GITHUB_WORKSPACE
  if (!ws) return p
  const rel = path.relative(ws, p)
  return rel.startsWith('..') ? p : rel.replace(/\\/g, '/')
}

async function main() {
  const inputPath = readInput('path', '.')
  const failOnWarnings = readBool('fail-on-warnings', false)
  const appVersion = readInput('app-version', '').trim()
  const apiUrl = readInput('api-reference-url', '').trim() || DEFAULT_API_REFERENCE_URL

  ga.startGroup('מאחזר מפרט API רשמי מ-GitHub')
  const rawSpec = await getApiSpec(apiUrl)
  const spec = mergeWithFallback(rawSpec)
  if (rawSpec.source === 'remote') {
    ga.info(`✓ מפרט ה-API נטען בזמן אמת מ-${apiUrl}`)
    ga.info(`  הרשאות: ${spec.permissions.size}, methods: ${spec.apiMethods.size}, events: ${spec.events.size}`)
  } else {
    ga.warning(
      `לא ניתן לאחזר את מפרט ה-API מ-GitHub (${rawSpec.error || 'שגיאה לא ידועה'}). ` +
      'נעשה שימוש ברשימת ה-fallback המובנית — ייתכן שאינה כוללת APIים חדשים.'
    )
  }
  ga.endGroup()

  let sources
  try {
    sources = discoverPlugins(inputPath)
  } catch (e) {
    ga.error(e.message)
    ga.setOutput('passed', 'false')
    ga.setOutput('total-plugins', '0')
    ga.setOutput('total-errors', '1')
    ga.setOutput('total-warnings', '0')
    process.exitCode = 1
    return
  }

  ga.info(`נמצאו ${sources.length} תוספים לבדיקה.`)

  const opts = {
    spec,
    appVersion: appVersion || null,
    skipAppVersion: appVersion === '',
  }

  let totalErrors = 0
  let totalWarnings = 0
  let totalDesign = 0
  const summaryRows = []
  const validated = []

  for (const source of sources) {
    let report
    try {
      report = validateSource(source, opts)
    } catch (e) {
      const file = workspaceRelative(source.file || source.root)
      ga.error(`כשל בקריאת התוסף: ${e.message}`, { file })
      totalErrors++
      summaryRows.push({ name: file, errors: 1, warnings: 0, design: 0, status: '❌' })
      continue
    }
    validated.push({ source, report })

    const file = workspaceRelative(report.manifestFile)
    const displayName = report.manifest ? `${report.manifest.name} (${report.manifest.id})` : file

    ga.startGroup(`בדיקת תוסף: ${displayName}`)
    for (const err of report.errors) ga.error(err, { file, title: 'Otzaria plugin error' })
    for (const warn of report.warnings) ga.warning(warn, { file, title: 'Otzaria plugin warning' })

    if (report.design && report.design.violations.length > 0) {
      for (const v of report.design.violations) ga.notice(v, { file, title: 'Otzaria design guide' })
    }
    if (report.unreferenced && report.unreferenced.length > 0) {
      ga.notice(
        `${report.unreferenced.length} קבצים ייארזו אך לא נראים מופנים מ-manifest/HTML/CSS/JS — ` +
        `שקול להסירם (שים לב: הפניות דינמיות אינן מזוהות): ${report.unreferenced.join(', ')}`,
        { file, title: 'Otzaria unused files' }
      )
    }
    if (report.errors.length === 0 && report.warnings.length === 0) {
      ga.info('✓ עבר ללא שגיאות ואזהרות.')
    }
    if (report.design && report.design.compliant) {
      ga.info('✓ העיצוב תואם לתיעוד אוצריא.')
    }
    ga.endGroup()

    totalErrors += report.errors.length
    totalWarnings += report.warnings.length
    const designCount = report.design ? report.design.violations.length : 0
    totalDesign += designCount
    summaryRows.push({
      name: displayName,
      errors: report.errors.length,
      warnings: report.warnings.length,
      design: designCount,
      status: report.errors.length > 0 ? '❌' : (report.warnings.length > 0 ? '⚠️' : '✅'),
    })
  }

  // Step summary.
  let md = '## תוצאות בדיקת תוספי אוצריא\n\n'
  md += `מקור מפרט ה-API: **${rawSpec.source === 'remote' ? 'GitHub (זמן אמת)' : 'fallback מובנה'}**\n\n`
  md += '| תוסף | שגיאות | אזהרות | עיצוב | סטטוס |\n|---|---|---|---|---|\n'
  for (const r of summaryRows) {
    md += `| ${r.name} | ${r.errors} | ${r.warnings} | ${r.design} | ${r.status} |\n`
  }
  ga.summary(md)

  ga.setOutput('total-plugins', String(sources.length))
  ga.setOutput('total-errors', String(totalErrors))
  ga.setOutput('total-warnings', String(totalWarnings))

  const failed = totalErrors > 0 || (failOnWarnings && totalWarnings > 0)
  ga.setOutput('passed', failed ? 'false' : 'true')
  ga.setOutput('published', 'false')
  ga.setOutput('pending-approval', 'false')

  ga.info('')
  ga.info(
    `סיכום: ${sources.length} תוספים, ${totalErrors} שגיאות, ${totalWarnings} אזהרות, ${totalDesign} הערות עיצוב.`
  )

  if (totalErrors > 0) {
    ga.error(`הבדיקה נכשלה: נמצאו ${totalErrors} שגיאות חוסמות.`)
    process.exitCode = 1
    return
  }
  if (failOnWarnings && totalWarnings > 0) {
    ga.error(`הבדיקה נכשלה: נמצאו ${totalWarnings} אזהרות (fail-on-warnings פעיל).`)
    process.exitCode = 1
    return
  }
  ga.info('✓ כל התוספים עברו את הבדיקה.')
  process.exitCode = 0

  await maybePublish(validated)
}

// Build the .otzplugin and push it to the store — only when explicitly enabled
// (or auto-enabled by the presence of all three secrets) and never on a
// pull_request event, to keep credentials away from fork PRs.
async function maybePublish(validated) {
  const mode = readInput('publish', 'auto').trim().toLowerCase()
  if (mode === 'false' || mode === 'off' || mode === 'no') return

  const user = readInput('otzaria-user', '').trim()
  const password = readInput('otzaria-password', '').trim()
  const pluginId = readInput('otzaria-plugin-id', '').trim()
  const baseUrl = readInput('base-url', 'https://otzaria.org').trim()
  const secretsPresent = user !== '' && password !== '' && pluginId !== ''

  if (mode === 'auto' && !secretsPresent) return // validate-only, no secrets configured

  const eventName = process.env.GITHUB_EVENT_NAME || ''
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    ga.warning('פרסום לחנות מבוטל באירוע pull_request מטעמי אבטחה. הפעל פרסום רק על push/tag/release.')
    return
  }
  if (!secretsPresent) {
    ga.error('פרסום הופעל אך חסרים סודות: נדרשים otzaria-user, otzaria-password ו-otzaria-plugin-id.')
    process.exitCode = 1
    return
  }

  const dirPlugins = validated.filter((v) => v.source.kind === 'dir' && v.report.manifest)
  if (dirPlugins.length !== 1) {
    ga.error(
      `פרסום לחנות דורש בדיוק תוסף אחד (תיקייה עם manifest), נמצאו ${dirPlugins.length}. ` +
      'הצבע על תיקיית התוסף הבודדת באמצעות הקלט path.'
    )
    process.exitCode = 1
    return
  }

  const { source, report } = dirPlugins[0]
  const manifest = report.manifest
  const outputName = readInput('output', '').trim() || `${manifest.id}-${manifest.version}.otzplugin`

  ga.startGroup(`פרסום לחנות: ${manifest.name} (${manifest.version})`)
  try {
    const built = buildOtzplugin(source.root, path.resolve(source.root, '..', outputName))
    ga.info(`נבנה ${path.basename(built.path)} — ${built.fileCount} קבצים, ${built.bytes} בתים`)
    ga.info(`SHA-256: ${built.sha256}`)
    ga.setOutput('plugin-file', built.path)
    ga.setOutput('sha256', built.sha256)

    const res = await publishToStore({
      baseUrl,
      user,
      password,
      pluginId,
      pluginFile: built.path,
      manifest,
      syncMetadata: readBool('sync-metadata', true),
      force: readBool('force', false),
      log: (m) => ga.info(m),
    })
    ga.setOutput('published', res.published ? 'true' : 'false')
    ga.setOutput('pending-approval', res.pendingApproval ? 'true' : 'false')
    if (res.published && res.pendingApproval) {
      ga.notice(res.message)
    } else {
      ga.info(`✓ ${res.message}`)
    }
  } catch (e) {
    ga.error(`פרסום לחנות נכשל: ${e.message}`)
    process.exitCode = 1
  } finally {
    ga.endGroup()
  }
}

main().catch((e) => {
  ga.error(`שגיאה לא צפויה: ${e && e.stack ? e.stack : e}`)
  process.exitCode = 1
})
