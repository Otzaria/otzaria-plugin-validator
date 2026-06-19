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
  else if (a === '-h' || a === '--help') {
    process.stdout.write(
      'Usage: node src/cli.js <path> [--fail-on-warnings] [--app-version X] [--api-reference-url U]\n'
    )
    process.exit(0)
  } else positional.push(a)
}
if (positional[0]) process.env.INPUT_PATH = positional[0]

require('./index')
