'use strict'

const path = require('path')
const ga = require('./githubActions')
const { getApiSpec, mergeWithFallback, DEFAULT_API_REFERENCE_URL } = require('./apiSpec')
const { discoverPlugins } = require('./discover')
const { validateSource } = require('./validatePlugin')

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

    const file = workspaceRelative(report.manifestFile)
    const displayName = report.manifest ? `${report.manifest.name} (${report.manifest.id})` : file

    ga.startGroup(`בדיקת תוסף: ${displayName}`)
    for (const err of report.errors) ga.error(err, { file, title: 'Otzaria plugin error' })
    for (const warn of report.warnings) ga.warning(warn, { file, title: 'Otzaria plugin warning' })

    if (report.design && report.design.violations.length > 0) {
      for (const v of report.design.violations) ga.notice(v, { file, title: 'Otzaria design guide' })
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

  ga.info('')
  ga.info(
    `סיכום: ${sources.length} תוספים, ${totalErrors} שגיאות, ${totalWarnings} אזהרות, ${totalDesign} הערות עיצוב.`
  )

  if (totalErrors > 0) {
    ga.error(`הבדיקה נכשלה: נמצאו ${totalErrors} שגיאות חוסמות.`)
    process.exitCode = 1
  } else if (failOnWarnings && totalWarnings > 0) {
    ga.error(`הבדיקה נכשלה: נמצאו ${totalWarnings} אזהרות (fail-on-warnings פעיל).`)
    process.exitCode = 1
  } else {
    ga.info('✓ כל התוספים עברו את הבדיקה.')
    process.exitCode = 0
  }
}

main().catch((e) => {
  ga.error(`שגיאה לא צפויה: ${e && e.stack ? e.stack : e}`)
  process.exitCode = 1
})
