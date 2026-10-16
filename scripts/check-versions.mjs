#!/usr/bin/env node
// Fails when a plugin changed since <base> without a higher version in its
// plugin.json. Installs update only when a plugin's version goes up, so a
// change pushed without a bump never reaches them.
//
//   node scripts/check-versions.mjs [<base>]    (default: origin/main)
//
// Run it before pushing; CI runs it on each push and pull request.

import { execFileSync } from 'node:child_process'

const MANIFEST = '.claude-plugin/plugin.json'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
}

// A plugin's version at a commit: undefined when the commit has no manifest
// for it, null when the manifest has no version
function versionAt(commit, dir) {
  let json
  try {
    json = git(['show', `${commit}:${dir}/${MANIFEST}`])
  } catch {
    return undefined
  }
  const { version } = JSON.parse(json)
  return typeof version === 'string' ? version : null
}

// [major, minor, patch] of a semver version, or null
function parse(version) {
  const m = typeof version === 'string' && version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  return m ? m.slice(1, 4).map(Number) : null
}

function isHigher(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

process.chdir(git(['rev-parse', '--show-toplevel']))
const base = process.argv[2] || 'origin/main'
let from
try {
  from = git(['rev-parse', '--verify', `${base}^{commit}`])
} catch {
  console.error(`check-versions: no commit ${base}`)
  process.exit(1)
}

const changed = new Set(
  git(['diff', '--name-only', from, 'HEAD', '--', 'plugins/'])
    .split('\n')
    .filter(Boolean)
    .map((file) => file.split('/').slice(0, 2).join('/')),
)
let failed = false
for (const dir of [...changed].sort()) {
  const now = versionAt('HEAD', dir)
  // Removed since base
  if (now === undefined && !git(['ls-tree', 'HEAD', dir])) continue
  const was = versionAt(from, dir)
  if (!parse(now)) {
    console.error(`${dir}: ${MANIFEST} needs a "version" like 1.0.0`)
    failed = true
  } else if (parse(was) && !isHigher(parse(now), parse(was))) {
    console.error(`${dir}: changed since ${base} but still at ${now}; bump its version`)
    failed = true
  } else {
    console.log(`${dir}: ${was || '(none)'} -> ${now}`)
  }
}
if (!changed.size) console.log(`No plugin changed since ${base}`)
process.exit(failed ? 1 : 0)
