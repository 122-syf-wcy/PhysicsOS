/** Real durable jobs for producer tests; child/model/artifact bytes remain test-owned. */
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { canonicalJson, type CodeExperimentRef } from '@physicsos/agent-tools'
import { questionCodeDomain, questionCodeRecordSchema } from '../../experiment-host/src/question-code-domain.ts'
import { QuestionCodeJobs } from '../../experiment-host/src/question-code-jobs.ts'
import type { CodeGenerationDependencies } from '../src/code-generation.ts'

type CreateInput = Parameters<CodeGenerationDependencies['create']>[0]
export const fixtureArtifactId = (id: string): string => /^qcode_[a-f0-9]{32}$/.test(id)
  ? id : `qcode_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`

export async function mountGenerationJobs(ctx: Context) {
  const root = await mkdtemp(join(tmpdir(), 'generation-jobs-'))
  const storage = new Context()
  let domain: storageDomain.Domain<typeof questionCodeDomain> | undefined
  // Register ownership before any asynchronous setup can fail.
  ctx.effect(() => async () => {
    try { await domain?.close(); await storage.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  await storage.plugin(Storage)
  await storage.plugin(storageJson, { root })
  await storage.plugin(storageDomain, { backend: 'json' })
  const opened = await storage.storageDomain.open(questionCodeDomain)
  domain = opened
  const jobs = new QuestionCodeJobs(opened)
  await jobs.initialize()
  ctx.provide('questionCodeJobs', jobs as never)

  const freeze = async <T extends CodeExperimentRef>(input: Pick<CreateInput, 'ownerSessionId' | 'generationId' | 'scene' | 'requestSha256'>, receipt: T): Promise<T> => {
    const job = jobs.get(input.generationId, 'school:student')
    const scene = input.scene as { id: string; revision: number }
    // Old mock receipts used synthetic ids/hashes. Persist the exact source
    // binding the production artifact service supplies, rather than mocking
    // the job store's source/lease fence or relaxing its assertions.
    const ref = { ...receipt, artifactId: fixtureArtifactId(receipt.artifactId), ownerSessionId: input.ownerSessionId,
      sceneId: String(scene.id), sceneRevision: scene.revision,
      sceneSha256: createHash('sha256').update(canonicalJson(input.scene)).digest('hex'),
      ...(input.requestSha256 === undefined ? {} : { requestSha256: input.requestSha256 }) }
    const row = { id: ref.artifactId, ownerSessionId: ref.ownerSessionId, ownerKey: 'school:student', generationId: input.generationId,
      childSessionId: ref.childSessionId, sceneId: ref.sceneId, sceneRevision: ref.sceneRevision, sceneSha256: ref.sceneSha256,
      ...(input.requestSha256 === undefined ? {} : { requestSha256: input.requestSha256 }),
      experimentId: ref.experimentId, sha256: ref.sha256, rendererKind: ref.rendererKind,
      title: ref.title, summary: '', createdAt: ref.createdAt, styleVersion: 'test', files: [] }
    if (job.sceneSha256 !== ref.sceneSha256 || job.requestSha256 !== input.requestSha256) throw new Error('fixture source binding mismatch')
    await opened.table('artifacts').put(ref.artifactId, questionCodeRecordSchema.parse(row))
    return ref
  }
  const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create?: CodeGenerationDependencies['create'] } | undefined
  if (artifacts?.create !== undefined) {
    const create = artifacts.create.bind(artifacts)
    artifacts.create = async (input, signal) => freeze(input, await create(input, signal))
  }
  return { domain: opened, jobs, freeze }
}
