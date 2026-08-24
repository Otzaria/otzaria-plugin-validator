#!/usr/bin/env node
'use strict'

// Refresh the vendored SDK spec (src/spec.json) from the Otzaria repo.
//
//   npm run sync:spec                       # from Otzaria/otzaria@dev
//   npm run sync:spec -- --from <path|url>  # from a local checkout or a URL
//
// The spec itself is GENERATED in the Otzaria repo
// (dart run tool/plugins/generate_plugin_spec.dart). Never hand-edit either copy.

const fs = require('fs')
const path = require('path')

const { DEFAULT_SPEC_URL, parseSpecJson } = require('../src/apiSpec')

const TARGET = path.join(__dirname, '..', 'src', 'spec.json')

function readFrom(source) {
  if (/^https?:\/\//.test(source)) {
    return fetch(source, { cache: 'no-store' }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${source}`)
      return res.text()
    })
  }
  const file = fs.statSync(source).isDirectory()
    ? path.join(source, 'docs', 'plugin-sdk', 'spec.json')
    : source
  return Promise.resolve(fs.readFileSync(file, 'utf8'))
}

async function main() {
  const idx = process.argv.indexOf('--from')
  const source = idx !== -1 ? process.argv[idx + 1] : DEFAULT_SPEC_URL
  if (!source) throw new Error('--from requires a path or URL')

  const text = await readFrom(source)
  parseSpecJson(text) // rejects a truncated or wrong-schema file before writing

  const before = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null
  if (before === text) {
    console.log(`src/spec.json is already up to date (source: ${source}).`)
    return
  }
  fs.writeFileSync(TARGET, text)
  console.log(`src/spec.json updated from ${source}.`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exitCode = 1
})
