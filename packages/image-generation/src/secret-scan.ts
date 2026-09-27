import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Secret-leak scanner (a reusable gate, not a one-off command).
 *
 * It answers one question: does any of the project's own text — source, docs,
 * fixtures, snapshots, design-asset manifests, generated reports — contain a
 * credential? Two rules are applied:
 *
 *   1. `key-pattern` — anything shaped like a provider key (`sk-` + 20 chars).
 *   2. `env-value`   — the literal value of a sensitive env var that is present
 *                      in the current environment (skipped when unset, e.g. CI).
 *
 * Findings never carry the secret: every piece of evidence is redacted to its
 * length only. Callers decide what to scan; `trackedFileInputs` covers the
 * repository as git sees it.
 */

const KEY_PATTERN_SOURCE = 'sk-[A-Za-z0-9_-]{20,}'

/** Env vars whose literal values must never appear in a tracked file. */
export const SENSITIVE_ENV_NAMES = [
  'PHYSICSOS_IMAGE_API_KEY',
  'PHYSICOS_IMAGE_API_KEY',
  'PHYSICSOS_MODEL_API_KEY',
  'DEEPSEEK_API_KEY',
  'PHYSICSOS_MODEL_POOL_SECRET',
  'PHYSICSOS_ADMIN_PASSWORD',
] as const

/** Binary assets cannot hold a reviewable token; reading them only adds noise. */
const BINARY_EXTENSIONS =
  /\.(?:png|jpe?g|webp|gif|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov|wasm|so|node)$/i

export interface SecretScanInput {
  /** Repo-relative path, used only for reporting. */
  file: string
  content: string
}

export interface SecretScanFinding {
  file: string
  line: number
  rule: 'key-pattern' | 'env-value'
  /** Length-only evidence; never the value itself. */
  masked: string
}

export interface SecretScanOptions {
  inputs: readonly SecretScanInput[]
  /** Literal values to hunt for; build with `sensitiveEnvValues`. */
  needles?: readonly string[]
}

/** Never returns any part of the value — not even a prefix. */
const mask = (value: string): string => `[redacted ${value.length} chars]`

/** Values of the sensitive env vars that are actually set. */
export const sensitiveEnvValues = (env: NodeJS.ProcessEnv): string[] =>
  SENSITIVE_ENV_NAMES.map((name) => (env[name] ?? '').trim()).filter((value) => value.length >= 8)

export const isProbablyBinary = (content: string, file: string): boolean =>
  BINARY_EXTENSIONS.test(file) || content.includes('\u0000')

export const scanForSecrets = ({
  inputs,
  needles = [],
}: SecretScanOptions): SecretScanFinding[] => {
  const findings: SecretScanFinding[] = []

  for (const input of inputs) {
    for (const [index, line] of input.content.split('\n').entries()) {
      const lineNumber = index + 1

      for (const match of line.matchAll(new RegExp(KEY_PATTERN_SOURCE, 'g'))) {
        findings.push({
          file: input.file,
          line: lineNumber,
          rule: 'key-pattern',
          masked: mask(match[0]),
        })
      }

      for (const needle of needles) {
        if (needle.length >= 8 && line.includes(needle)) {
          findings.push({
            file: input.file,
            line: lineNumber,
            rule: 'env-value',
            masked: mask(needle),
          })
        }
      }
    }
  }

  return findings
}

/**
 * Every tracked file git can see. `git ls-files` is repo-root relative, so the
 * root must be passed explicitly — running it from a package directory would
 * scan only that subtree and pass vacuously.
 */
export const trackedFileInputs = (repoRoot: string): SecretScanInput[] => {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  const inputs: SecretScanInput[] = []
  for (const file of listed.split('\u0000')) {
    if (file.length === 0 || BINARY_EXTENSIONS.test(file)) continue
    let content: string
    try {
      content = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      continue
    }
    if (isProbablyBinary(content, file)) continue
    inputs.push({ file, content })
  }
  return inputs
}

export const formatFinding = (finding: SecretScanFinding): string =>
  `${finding.file}:${finding.line}: ${finding.rule} ${finding.masked}`
