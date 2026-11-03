/** Authenticated prompt management client; publication reads are separate public endpoints. */
import {
  validPromptBinding,
  validPromptDocument,
  validateBody,
  PROMPT_VERSION,
  type PromptDocument,
  type PromptSeed,
} from './developer-prompt-format.ts'

export interface PromptDraft {
  version: string
  body: string
  note: string
  bindingFingerprint: string
  updatedBy: string
  updatedAt: string
}
export interface PromptVersion extends PromptDocument {
  note: string
  publishedBy: string
}
export interface PromptAdminView {
  revision: number
  current: PromptDocument
  draft: PromptDraft | null
  versions: PromptVersion[]
  seed: PromptSeed
  bindingChanged: boolean
}
export interface PromptDraftInput {
  expectedRevision: number
  version: string
  body: string
  note: string
}
export interface PromptImportInput {
  expectedRevision: number
  version: string
  note: string
  filename: string
  base64: string
}
export interface DeveloperPromptApi {
  get: () => Promise<PromptAdminView>
  save: (input: PromptDraftInput) => Promise<PromptAdminView>
  import: (input: PromptImportInput) => Promise<PromptAdminView>
  publish: (input: { expectedRevision: number }) => Promise<PromptAdminView>
  activate: (input: {
    expectedRevision: number
    id: string
    expectedSha256: string
  }) => Promise<PromptAdminView>
}
export class DeveloperPromptApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DeveloperPromptApiError'
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
function validView(value: unknown): value is PromptAdminView {
  if (
    !object(value) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !validPromptDocument(value.current) ||
    !object(value.seed) ||
    typeof value.seed.body !== 'string' ||
    !validPromptBinding(value.seed.binding) ||
    typeof value.bindingChanged !== 'boolean' ||
    !Array.isArray(value.versions) ||
    value.versions.length > 200 ||
    !value.versions.every(
      item =>
        validPromptDocument(item) &&
        object(item) &&
        typeof item.note === 'string' &&
        typeof item.publishedBy === 'string',
    )
  )
    return false
  try {
    validateBody(value.seed.body)
    const draft = value.draft
    if (draft === null) return true
    if (
      !object(draft) ||
      typeof draft.version !== 'string' ||
      draft.version.length > 32 ||
      !PROMPT_VERSION.test(draft.version) ||
      typeof draft.body !== 'string' ||
      typeof draft.note !== 'string' ||
      typeof draft.bindingFingerprint !== 'string' ||
      typeof draft.updatedBy !== 'string' ||
      typeof draft.updatedAt !== 'string'
    )
      return false
    return validateBody(draft.body) === draft.body
  } catch {
    return false
  }
}
async function request(action = '', input?: unknown): Promise<PromptAdminView> {
  const response = await fetch(`/physicsos/developer-prompts/admin${action}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(input === undefined
      ? {}
      : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = object(body) && object(body.error) ? body.error : undefined
    throw new DeveloperPromptApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
      typeof error?.message === 'string' ? error.message : '提示词请求失败，请稍后重试。',
    )
  }
  if (!validView(body))
    throw new DeveloperPromptApiError(502, 'INVALID_RESPONSE', '提示词返回内容不完整，请重新加载。')
  return body
}
export function createDeveloperPromptApi(): DeveloperPromptApi {
  return {
    get: () => request(),
    save: input => request('/draft', input),
    import: input => request('/import', input),
    publish: input => request('/publish', input),
    activate: input => request('/activate', input),
  }
}
