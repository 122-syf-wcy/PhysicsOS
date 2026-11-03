/** Prompt publication is an independent atomic row, separate from experiment archives. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import {
  validPromptBinding,
  validateBody,
  PROMPT_VERSION,
  type PromptBinding,
} from './prompt-format.ts'

export const promptVersionSchema = z.string().max(32).regex(PROMPT_VERSION)
export const promptBodySchema = z.string().refine((value) => {
  try {
    return validateBody(value) === value
  } catch {
    return false
  }
})
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const binding = z.custom<PromptBinding>(validPromptBinding)
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const draft = z.object({
  version: promptVersionSchema,
  body: promptBodySchema,
  note: z.string().max(500),
  bindingFingerprint: digest,
  updatedBy: z.string().min(1),
  updatedAt: z.iso.datetime(),
})
const version = z.object({
  id: z.string().regex(/^prompt_[a-f0-9]{32}$/),
  version: promptVersionSchema,
  body: promptBodySchema,
  sha256: digest,
  binding,
  publishedAt: z.iso.datetime(),
  publishedBy: z.string().min(1),
  note: z.string().max(500),
})
export const promptStateSchema = z.object({
  revision: counter,
  draft: draft.nullable(),
  versions: z.array(version).max(200),
  activeId: z.string().nullable(),
  releases: z
    .array(
      z.object({
        action: z.enum(['publish', 'activate']),
        id: z.string(),
        actorKey: z.string().min(1),
        createdAt: z.iso.datetime(),
        revision: counter,
      }),
    )
    .max(1000),
})
export type PromptState = z.infer<typeof promptStateSchema>
export type PromptDraft = NonNullable<PromptState['draft']>
export type PromptVersionRecord = PromptState['versions'][number]
export const developerPromptDomain = defineDomain({
  name: 'physicsos_developer_prompts',
  version: 0,
  tables: { state: domainTable<string, PromptState>(promptStateSchema) },
})
export const openDeveloperPromptDomain = (ctx: {
  storageDomain: {
    open(spec: typeof developerPromptDomain): Promise<Domain<typeof developerPromptDomain>>
  }
}): Promise<Domain<typeof developerPromptDomain>> => ctx.storageDomain.open(developerPromptDomain)
