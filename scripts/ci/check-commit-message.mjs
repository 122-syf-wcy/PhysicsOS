#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const ALLOWED_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
]

const CONVENTIONAL_MESSAGE = new RegExp(
  `^(?:${ALLOWED_TYPES.join('|')})\\([a-z0-9][a-z0-9._/-]*\\)!?: .+$`,
)
const CODEX_BRANCH = /^codex\/[a-z0-9][a-z0-9._/-]*$/i
const MERGE_MESSAGE = /^Merge (?:branch|pull request|remote-tracking branch|tag) /
const REVERT_MESSAGE = /^(?:Revert ".+"|revert(?:\([a-z0-9][a-z0-9._/-]*\))?!?: .+)$/i

function fail(message, received) {
  const lines = [
    'Invalid commit or pull request title.',
    `Received: ${received || '(empty)'}`,
    'Expected: type(scope): subject',
    'Examples:',
    '  feat(ci): add release automation',
    '  fix(auth): reject expired reset tokens',
    '  revert: feat(ci): add release automation',
    'Merge commits and Revert "..." commits are also accepted.',
    'Codex branches (codex/*) are exempt from this check.',
  ]

  if (message) {
    lines.unshift(message)
  }

  throw new Error(lines.join('\n'))
}

export function validateCommitMessage(message, branch = '') {
  const firstLine = String(message ?? '')
    .split(/\r?\n/u, 1)[0]
    .trim()

  if (!firstLine) {
    fail('The commit or pull request title is empty.', firstLine)
  }

  if (CODEX_BRANCH.test(branch)) {
    return { exempt: true, firstLine }
  }

  if (
    CONVENTIONAL_MESSAGE.test(firstLine) ||
    MERGE_MESSAGE.test(firstLine) ||
    REVERT_MESSAGE.test(firstLine)
  ) {
    return { exempt: false, firstLine }
  }

  fail('', firstLine)
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    return {}
  }

  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'))
  } catch {
    return {}
  }
}

function readGitMessage() {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%s'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function parseArguments(argv) {
  const options = {
    branch:
      process.env.HEAD_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME ?? '',
    message: process.env.PR_TITLE ?? process.env.COMMIT_MESSAGE ?? '',
    selfTest: false,
  }
  const event = readEventPayload()

  if (event.pull_request) {
    options.branch ||= event.pull_request.head?.ref ?? ''
    options.message ||= event.pull_request.title ?? ''
  } else if (event.head_commit) {
    options.message ||= event.head_commit.message ?? ''
  }

  options.message ||= readGitMessage()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--self-test') {
      options.selfTest = true
      continue
    }

    if (argument === '--branch' || argument === '--message' || argument === '--pr-title') {
      const value = argv[index + 1]
      if (!value) {
        fail(`Missing value for ${argument}.`, argument)
      }
      index += 1

      if (argument === '--branch') {
        options.branch = value
      } else {
        options.message = value
      }
      continue
    }

    fail(`Unknown argument: ${argument}`, argument)
  }

  return options
}

function runSelfTest() {
  const cases = [
    ['feat(ci): add release automation', 'feature/release', true],
    ['fix(auth): reject expired reset tokens', 'fix/auth-token', true],
    ['revert: feat(ci): add release automation', 'chore/revert-release', true],
    ['Revert "feat(ci): add release automation"', 'chore/revert-release', true],
    ['Merge pull request #42 from example/feature', 'feature/merge', true],
    ['codex/experiment-studio-polish', 'codex/experiment-studio-polish', true],
    ['Add CI workflow', 'feature/ci', false],
    ['feat: add release automation', 'feature/release', false],
    ['FEAT(ci): add release automation', 'feature/release', false],
  ]

  for (const [message, branch, expected] of cases) {
    let actual = true

    try {
      validateCommitMessage(message, branch)
    } catch {
      actual = false
    }

    if (actual !== expected) {
      throw new Error(
        `Self-test failed for "${message}" on "${branch}": expected ${expected}, received ${actual}.`,
      )
    }
  }

  console.log(`Commit message policy self-test passed (${cases.length} cases).`)
}

function main() {
  const options = parseArguments(process.argv.slice(2))

  if (options.selfTest) {
    runSelfTest()
    return
  }

  const result = validateCommitMessage(options.message, options.branch)
  if (result.exempt) {
    console.log(`Commit message policy skipped for Codex branch "${options.branch}".`)
    return
  }

  console.log(`Commit message policy passed: ${result.firstLine}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
