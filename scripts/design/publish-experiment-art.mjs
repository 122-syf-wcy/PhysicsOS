#!/usr/bin/env node
/**
 * Publish generated experiment-card art.
 *
 * `generate-experiment-art.mjs` writes 2048x2048 PNGs plus provenance JSON into
 * `UI/generated/experiment-art/` — a directory `.gitignore` excludes, because
 * the raw set is large. The cards actually load
 * `overlays/harness/files/apps/web/public/physicsos/experiment-art/<id>.jpg` at
 * 512x512, and until this script existed that downscale was done by hand, so the
 * shipped covers could silently drift from the generated originals (or simply
 * never appear, which is why ten templates were still falling back to the inline
 * SVG piece).
 *
 * This closes the loop: every generated PNG is resized and written to the served
 * path, and only files that actually changed are reported.
 *
 * Usage:
 *   node scripts/design/publish-experiment-art.mjs            # every generated PNG
 *   node scripts/design/publish-experiment-art.mjs vt-area    # selected ids
 *   node scripts/design/publish-experiment-art.mjs --check    # verify only
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SRC_DIR = path.join(ROOT, 'UI', 'generated', 'experiment-art')
const OUT_DIR = path.join(
  ROOT,
  'overlays',
  'harness',
  'files',
  'apps',
  'web',
  'public',
  'physicsos',
  'experiment-art',
)

/** The size the cards request; matches the existing published covers. */
const EDGE = 512

const argv = process.argv.slice(2)
const checkOnly = argv.includes('--check')
const wanted = argv.filter((arg) => !arg.startsWith('--'))

if (!existsSync(SRC_DIR)) {
  process.stderr.write(
    `no generated art at ${path.relative(ROOT, SRC_DIR)} — run generate-experiment-art.mjs first\n`,
  )
  process.exit(1)
}
mkdirSync(OUT_DIR, { recursive: true })

const ids =
  wanted.length > 0
    ? wanted
    : readdirSync(SRC_DIR)
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.slice(0, -4))
if (ids.length === 0) {
  process.stderr.write('no source PNGs to publish\n')
  process.exit(1)
}

let published = 0
let missing = 0
let stale = 0

for (const id of ids) {
  const source = path.join(SRC_DIR, `${id}.png`)
  const target = path.join(OUT_DIR, `${id}.jpg`)
  if (!existsSync(source)) {
    stdout.write(`  \u2717 ${id}: no generated PNG\n`)
    missing++
    continue
  }
  if (checkOnly) {
    if (!existsSync(target)) {
      stdout.write(`  \u2717 ${id}: not published\n`)
      missing++
    } else if (statSync(target).mtimeMs < statSync(source).mtimeMs) {
      stdout.write(`  \u2717 ${id}: published copy is older than the source\n`)
      stale++
    } else {
      stdout.write(`  \u2713 ${id}\n`)
    }
    continue
  }
  /* sips ships with macOS; it is the only image tool this repo can assume. */
  execFileSync(
    'sips',
    [
      '-Z',
      String(EDGE),
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      '82',
      source,
      '--out',
      target,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  stdout.write(`  \u2713 ${id}.jpg  ${(statSync(target).size / 1024).toFixed(0)} KiB\n`)
  published++
}

if (checkOnly) {
  stdout.write(`\n${ids.length - missing - stale}/${ids.length} published and current\n`)
  if (missing > 0 || stale > 0) process.exitCode = 1
} else {
  stdout.write(`\n${published} published, ${missing} missing\n`)
}
