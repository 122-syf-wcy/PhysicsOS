#!/usr/bin/env node
/**
 * Run production dependency audits against an explicit registry.
 *
 * The configured npmmirror registry lacks npm's bulk advisory endpoint, which
 * made `pnpm audit` fail before it could inspect anything. CI and release
 * checks use this wrapper so a mirror outage is never mistaken for a clean
 * dependency result.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registry = process.env.NPM_AUDIT_REGISTRY ?? 'https://registry.npmjs.org'
const roots = process.argv.includes('--vendor-only')
  ? [path.join(root, 'vendor', 'deepseek-harness')]
  : process.argv.includes('--root-only')
    ? [root]
    : [root, path.join(root, 'vendor', 'deepseek-harness')]

for (const cwd of roots) {
  if (!existsSync(path.join(cwd, 'package.json'))) {
    throw new Error(`no package.json under ${cwd}`)
  }
  process.stdout.write(`\nAudit ${path.relative(root, cwd) || '.'} via ${registry}\n`)
  const result = spawnSync('pnpm', [
    'audit',
    '--prod',
    '--audit-level',
    'high',
    '--registry',
    registry,
  ], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
