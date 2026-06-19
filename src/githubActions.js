'use strict'

const fs = require('fs')

// Minimal GitHub Actions toolkit: workflow commands over stdout + file outputs.
// Avoids depending on @actions/core so the action needs no bundling step.

const isActions = !!process.env.GITHUB_ACTIONS

function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
function escapeProp(s) {
  return String(s)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C')
}

function command(cmd, props, message) {
  let line = `::${cmd}`
  const keys = props ? Object.keys(props).filter((k) => props[k] !== undefined && props[k] !== '') : []
  if (keys.length > 0) {
    line += ' ' + keys.map((k) => `${k}=${escapeProp(props[k])}`).join(',')
  }
  line += `::${escapeData(message == null ? '' : message)}`
  process.stdout.write(line + '\n')
}

function error(message, props) {
  if (isActions) command('error', props, message)
  else process.stdout.write(`ERROR: ${message}\n`)
}
function warning(message, props) {
  if (isActions) command('warning', props, message)
  else process.stdout.write(`WARNING: ${message}\n`)
}
function notice(message, props) {
  if (isActions) command('notice', props, message)
  else process.stdout.write(`NOTICE: ${message}\n`)
}
function info(message) {
  process.stdout.write(`${message}\n`)
}
function startGroup(name) {
  if (isActions) process.stdout.write(`::group::${escapeData(name)}\n`)
  else process.stdout.write(`\n=== ${name} ===\n`)
}
function endGroup() {
  if (isActions) process.stdout.write('::endgroup::\n')
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT
  const v = typeof value === 'string' ? value : String(value)
  if (file) {
    // multiline-safe heredoc form
    const delimiter = `ghadelimiter_${name}`
    fs.appendFileSync(file, `${name}<<${delimiter}\n${v}\n${delimiter}\n`)
  } else {
    process.stdout.write(`OUTPUT ${name}=${v}\n`)
  }
}

function summary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) fs.appendFileSync(file, markdown + '\n')
}

module.exports = {
  isActions,
  error,
  warning,
  notice,
  info,
  startGroup,
  endGroup,
  setOutput,
  summary,
}
