import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

test('prompt seed and portable consumers match the existing immutable release without repacking it', async () => {
  const root = new URL('../../', import.meta.url)
  const archive = new URL('overlays/harness/files/apps/web/public/physicsos/developers/downloads/physicsos-experiment-template-v2.zip', root)
  const before = createHash('sha256').update(await readFile(archive)).digest('hex')
  const check = spawnSync(process.execPath, ['scripts/developers/generate-prompts.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr || check.stdout)
  const { PROMPT_SEED } = await import('../../overlays/harness/files/packages/physicsos/experiment-host/src/prompt-seed.ts')
  assert.equal(PROMPT_SEED.binding.release.sha256, before)
  assert.equal(PROMPT_SEED.binding.release.bytes, (await readFile(archive)).length)
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), before)
})
