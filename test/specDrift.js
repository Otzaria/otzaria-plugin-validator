'use strict'

// בדיקת סחיפה מול המסמך הרשמי החי. המיפוי method → הרשאה נגזר מהטקסט של
// API_REFERENCE.md, ולכן שינוי בפורמט הכותרות או בשורת "**הרשאה:**" יפסיק
// לייצר אזהרות — בשקט. הבדיקה הזו הופכת את זה לכשל ב-CI של הוולידטור,
// במקום לאבד את האזהרה אצל מפתחי התוספים.
//
// רצה מול הרשת בכוונה, ולכן היא job נפרד ולא חלק מ-npm test.

const { getApiSpec } = require('../src/apiSpec')
const { METHOD_REQUIRED_PERMISSION } = require('../src/knownApi')

// רצפה שמרנית: כיום נגזרים ~99. נפילה מתחת לזה משמעה שהפורמט השתנה.
const MIN_EXPECTED_MAPPINGS = 80

async function main() {
  const spec = await getApiSpec()

  if (spec.source !== 'remote') {
    console.log(`דילוג: המסמך החי לא נטען (${spec.error || 'שגיאה לא ידועה'}).`)
    return
  }

  const parsed = spec.methodPermissions || new Map()
  console.log(`נגזרו ${parsed.size} מיפויי method → הרשאה מהמסמך.`)

  const conflicts = []
  for (const [method, hardcoded] of Object.entries(METHOD_REQUIRED_PERMISSION)) {
    const fromDoc = parsed.get(method)
    if (fromDoc && fromDoc !== hardcoded) {
      conflicts.push(`  ${method}: מסמך=${fromDoc} מובנה=${hardcoded}`)
    }
  }

  const problems = []
  if (parsed.size < MIN_EXPECTED_MAPPINGS) {
    problems.push(
      `נגזרו ${parsed.size} מיפויים בלבד (מצופה לפחות ${MIN_EXPECTED_MAPPINGS}) — ` +
      'ככל הנראה פורמט המסמך השתנה.'
    )
  }
  if (conflicts.length > 0) {
    problems.push(`סתירות בין המסמך למפה המובנית:\n${conflicts.join('\n')}`)
  }

  if (problems.length > 0) {
    console.error(`✗ ${problems.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log('✓ אין סתירות מול המפה המובנית.')
}

main()
