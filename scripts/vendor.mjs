#!/usr/bin/env node
// Forks plugins from other repos into this one and merges their upstream
// changes later, keeping local edits. Works like `git subtree --squash`, but
// can take a subdirectory of the upstream repo and needs nothing but git and
// node, so it runs the same on Windows and in CI.
//
//   node scripts/vendor.mjs add <prefix> <repo-url> [--branch main] [--path <dir>] [--file <path>]... [--exclude <pathspec>]...
//   node scripts/vendor.mjs sync [<prefix>...]
//
// --path imports that directory of the upstream repo instead of its root.
// --file also copies an upstream file (a repo-root path, such as LICENSE) to
// the root of the prefix. --exclude leaves out what a git pathspec matches,
// relative to the imported directory (`docs/*.png` matches in subfolders too).
// Upstreams are recorded in upstreams.json.
//
// Each import is a commit of the upstream tree with no history of its own,
// merged into the prefix. The previous import is the merge base of the next,
// so upstream changes and local edits merge like any two branches.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'

const CONFIG = 'upstreams.json'
const MANIFEST = '.claude-plugin/plugin.json'

function git(args, { trim = true, ...opts } = {}) {
  const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts })
  return trim ? out.trim() : out
}

function fail(message) {
  console.error(`vendor: ${message}`)
  process.exit(1)
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function readConfig() {
  return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {}
}

function requireClean() {
  if (git(['status', '--porcelain'])) fail('commit or stash your changes first')
}

function fetchUpstream({ repo, branch }) {
  execFileSync('git', ['fetch', '--no-tags', repo, branch], { stdio: 'inherit' })
  return git(['rev-parse', 'FETCH_HEAD^{commit}'])
}

// Without a version, Claude Code versions a plugin by its git commit, so every
// push here reaches the installs that auto-update. Upstream's pinned version
// would hold them back until someone bumped it, so imports leave it out.
function unpinVersion(json) {
  const parsed = JSON.parse(json)
  if (!('version' in parsed)) return json
  const { version, ...rest } = parsed
  const line = new RegExp(`^[ \\t]*"version"[ \\t]*:[ \\t]*${escapeRegex(JSON.stringify(version))},?[ \\t]*\\r?\\n`, 'm')
  const edited = json.replace(line, '')
  try {
    if (JSON.stringify(JSON.parse(edited)) === JSON.stringify(rest)) return edited
  } catch {}
  return JSON.stringify(rest, null, 2) + '\n'
}

// The upstream tree to import: its root or --path directory, less the
// --exclude matches, plus the --file extras, with the plugin manifest unpinned.
function importTree(commit, { path, files = [], exclude = [] }) {
  const source = path ? `${commit}:${path}` : `${commit}^{tree}`
  let type = ''
  try {
    type = git(['cat-file', '-t', source], { stdio: ['pipe', 'pipe', 'ignore'] })
  } catch {}
  if (type !== 'tree') fail(`${path} is not a directory upstream`)
  const index = join(tmpdir(), `vendor-index-${process.pid}`)
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    git(['read-tree', source], { env })
    if (exclude.length) git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...exclude], { env })
    for (const file of files) {
      const [mode, , blob] = git(['ls-tree', commit, file]).split(/\s+/)
      if (!blob) fail(`${file} not found upstream`)
      git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${basename(file)}`], { env })
    }
    const entry = git(['ls-files', '--stage', MANIFEST], { env })
    if (entry) {
      const [mode, blob] = entry.split(/\s+/)
      const json = git(['cat-file', 'blob', blob], { trim: false })
      const unpinned = unpinVersion(json)
      if (unpinned !== json) {
        const edited = git(['hash-object', '-w', '--stdin'], { input: unpinned })
        git(['update-index', '--cacheinfo', `${mode},${edited},${MANIFEST}`], { env })
      }
    }
    return git(['write-tree'], { env })
  } finally {
    rmSync(index, { force: true })
  }
}

// The latest import of a prefix: ours, or one made by `git subtree --squash`.
function lastImport(prefix) {
  return git(['log', '-1', '--no-merges', '--format=%H', '-E', `--grep=^(vendor|git-subtree)-dir: ${escapeRegex(prefix)}/*$`, 'HEAD'])
}

function importCommit(prefix, { repo, path }, commit, tree, parent) {
  const from = `${repo} ${commit.slice(0, 7)}${path ? ` (${path})` : ''}`
  let message = `Import '${prefix}/' from ${from}\n\n`
  if (parent) {
    const body = git(['log', '-1', '--format=%B', parent])
    const previous = body.match(/^(?:vendor-commit|git-subtree-split): (\w+)/m)?.[1]
    try {
      const log = previous && git(['log', '--format=- %h %s', `${previous}..${commit}`, '--', path || '.'], { stdio: ['pipe', 'pipe', 'ignore'] })
      if (log) message += `${log}\n\n`
    } catch {}
  }
  message += `vendor-dir: ${prefix}\nvendor-commit: ${commit}\n`
  return git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-F', '-'], { input: message })
}

function add(prefix, upstream) {
  requireClean()
  if (git(['ls-tree', 'HEAD', prefix])) fail(`${prefix} already exists`)
  const commit = fetchUpstream(upstream)
  const imported = importCommit(prefix, upstream, commit, importTree(commit, upstream), null)
  git(['merge', '-s', 'ours', '--no-commit', '--allow-unrelated-histories', imported])
  git(['read-tree', `--prefix=${prefix}/`, '-u', imported])
  writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), [prefix]: upstream }, null, 2) + '\n')
  git(['add', CONFIG])
  git(['commit', '-q', '-m', `Fork ${prefix} from ${upstream.repo}`])
  console.log(`${prefix}: added at ${commit.slice(0, 7)}`)
}

function sync(prefix, upstream) {
  requireClean()
  const last = lastImport(prefix)
  if (!last) fail(`${prefix} was never imported; use add`)
  const commit = fetchUpstream(upstream)
  const tree = importTree(commit, upstream)
  if (tree === git(['rev-parse', `${last}^{tree}`])) return console.log(`${prefix}: up to date`)
  const imported = importCommit(prefix, upstream, commit, tree, last)
  try {
    execFileSync('git', ['merge', '--no-ff', `-Xsubtree=${prefix}`, '-m', `Merge upstream ${commit.slice(0, 7)} into ${prefix}`, imported], { stdio: 'inherit' })
  } catch {
    fail(`${prefix}: resolve the conflicts above, then git commit`)
  }
  console.log(`${prefix}: merged upstream ${commit.slice(0, 7)}`)
}

const [command, ...args] = process.argv.slice(2)
process.chdir(git(['rev-parse', '--show-toplevel']))
const normalize = (prefix) => prefix.replace(/\\/g, '/').replace(/\/+$/, '')

if (command === 'add') {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      branch: { type: 'string', default: 'main' },
      path: { type: 'string' },
      file: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
    },
  })
  if (positionals.length !== 2) fail('usage: add <prefix> <repo-url> [--branch main] [--path <dir>] [--file <path>]... [--exclude <pathspec>]...')
  const [prefix, repo] = positionals
  add(normalize(prefix), {
    repo,
    branch: values.branch,
    ...(values.path && { path: normalize(values.path) }),
    ...(values.file && { files: values.file }),
    ...(values.exclude && { exclude: values.exclude }),
  })
} else if (command === 'sync') {
  const config = readConfig()
  const prefixes = args.length ? args.map(normalize) : Object.keys(config)
  for (const prefix of prefixes) {
    if (!config[prefix]) fail(`${prefix} is not in ${CONFIG}`)
    sync(prefix, config[prefix])
  }
} else {
  fail('usage: node scripts/vendor.mjs add <prefix> <repo-url> [options] | sync [<prefix>...]')
}
