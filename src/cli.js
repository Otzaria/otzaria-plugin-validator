#!/usr/bin/env node
'use strict'

// Local CLI wrapper: run the same validation outside of GitHub Actions.
//   node src/cli.js <path> [--fail-on-warnings] [--app-version X] [--api-reference-url U]
const args = process.argv.slice(2)
const positional = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  // Use the same INPUT_ keys that GitHub sets (spaces->_, uppercased, hyphens kept).
  if (a === '--fail-on-warnings') process.env['INPUT_FAIL-ON-WARNINGS'] = 'true'
  else if (a === '--app-version') process.env['INPUT_APP-VERSION'] = args[++i] || ''
  else if (a === '--api-reference-url') process.env['INPUT_API-REFERENCE-URL'] = args[++i] || ''
  else if (a === '--publish') process.env.INPUT_PUBLISH = args[++i] || 'true'
  else if (a === '--otzaria-user') process.env['INPUT_OTZARIA-USER'] = args[++i] || ''
  else if (a === '--otzaria-password') process.env['INPUT_OTZARIA-PASSWORD'] = args[++i] || ''
  else if (a === '--otzaria-plugin-id') process.env['INPUT_OTZARIA-PLUGIN-ID'] = args[++i] || ''
  else if (a === '--base-url') process.env['INPUT_BASE-URL'] = args[++i] || ''
  else if (a === '--screenshots') process.env.INPUT_SCREENSHOTS = args[++i] || ''
  else if (a === '--description') process.env.INPUT_DESCRIPTION = args[++i] || ''
  else if (a === '--no-sync-metadata') process.env['INPUT_SYNC-METADATA'] = 'false'
  else if (a === '--force') process.env.INPUT_FORCE = 'true'
  else if (a === '-h' || a === '--help') {
    process.stdout.write(
      'Usage: node src/cli.js <path> [--fail-on-warnings] [--app-version X] [--api-reference-url U]\n' +
      '       [--publish auto|true|false] [--otzaria-user U] [--otzaria-password P] [--otzaria-plugin-id ID] [--base-url URL]\n'
    )
    process.exit(0)
  } else positional.push(a)
}
if (positional[0]) process.env.INPUT_PATH = positional[0]

require('./index')
