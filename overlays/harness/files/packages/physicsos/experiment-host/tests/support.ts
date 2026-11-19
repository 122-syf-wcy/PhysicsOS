import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { constants } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openExperimentDomain } from '../src/domain.ts'
import { ExperimentService } from '../src/service.ts'
export async function host(
  root: string,
  options: { assetOrigin?: string; previewTtlMs?: number } = {},
) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: join(root, 'domain') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  const domain = await openExperimentDomain(ctx)
  const service = new ExperimentService(domain, { root: join(root, 'files'), ...options })
  await service.initialize()
  return {
    ctx,
    domain,
    service,
    close: async () => {
      await domain.close()
      await ctx.fiber.dispose()
    },
  }
}

/**
 * Replace only an archive created under this test's private root, then restore its frozen mode.
 * @param root - The test-owned mkdtemp root passed to host().
 * @param packageId - The package uploaded by this test.
 * @param bytes - Deliberate corruption or a historical migration fixture.
 * @returns after replacement, mode restoration and handle close.
 */
export async function overwriteFrozenTestArchive(
  root: string,
  packageId: string,
  bytes: string | Buffer,
): Promise<void> {
  const path = join(root, 'files', packageId, 'archive.zip')
  const frozen = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await frozen.stat()
    if (!stat.isFile()) throw new Error('Expected a test-owned archive file')
    const mode = stat.mode & 0o777
    await frozen.chmod(mode | 0o200)
    try {
      await writeFile(path, bytes, {
        flag: constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
      })
    } finally {
      await frozen.chmod(mode)
    }
  } finally {
    await frozen.close()
  }
}
