/** Actor-scoped reusable materials. Only authenticated, digest-bound PNG bytes become previews. */
const BASE = '/physicsos/visual-materials'
export type VisualMaterialKind = 'environment' | 'material'
export type VisualMaterialLifecycle = 'pending' | 'ready' | 'deleted' | 'canceled' | 'failed'
export type VisualMaterialVisibility = 'private' | 'school'
export interface VisualMaterialDescriptor {
  readonly id: string
  readonly revision: number
  readonly sha256: string
  readonly byteLength: number
  readonly mediaType: 'image/png'
  readonly width: number
  readonly height: number
  readonly kind: VisualMaterialKind
  readonly theme: string
  readonly purpose: string
  readonly tags: readonly string[]
  readonly style?: string
  readonly model: string
  readonly lifecycle: VisualMaterialLifecycle
  readonly visibility: VisualMaterialVisibility
  readonly createdAt: number
  readonly updatedAt: number
  readonly metadataTrust: 'untrusted'
}
export interface VisualMaterialPage { readonly items: readonly VisualMaterialDescriptor[]; readonly nextCursor?: string }
export interface VisualMaterialSearch {
  readonly query?: string
  readonly theme?: string
  readonly purpose?: string
  readonly kind?: VisualMaterialKind
  readonly tags?: readonly string[]
  readonly style?: string
  readonly minWidth?: number
  readonly minHeight?: number
  readonly cursor?: string
  readonly limit?: number
}
export interface VisualMaterialList { readonly lifecycle?: VisualMaterialLifecycle | 'all'; readonly cursor?: string; readonly limit?: number }
export interface VisualMaterialUsage {
  readonly bytes: number
  readonly count: number
  readonly operations: number
  readonly activeCount: number
  readonly stageBytes: number
}
export interface VisualMaterialQuota { readonly account: VisualMaterialUsage; readonly global: VisualMaterialUsage }
export interface ManageVisualMaterial {
  readonly expectedRevision: number
  readonly operationId: string
  readonly updateTags?: readonly string[]
  readonly visibility?: VisualMaterialVisibility
  readonly softdelete?: true
  readonly restore?: true
}
export class VisualMaterialApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super('Visual material request failed')
    this.name = 'VisualMaterialApiError'
  }
}

async function responseFor(path: string, signal: AbortSignal, input?: ManageVisualMaterial): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    method: input === undefined ? 'GET' : 'PATCH', signal, credentials: 'same-origin', cache: 'no-store',
    ...(input === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => undefined)
    const error = data !== null && typeof data === 'object' && 'error' in data ? data.error : undefined
    const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : `HTTP_${response.status}`
    throw new VisualMaterialApiError(response.status, code)
  }
  return response
}
async function request<T>(path: string, signal: AbortSignal, input?: ManageVisualMaterial): Promise<T> {
  const response = await responseFor(path, signal, input)
  const data: unknown = await response.json().catch(() => undefined)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new VisualMaterialApiError(502, 'INVALID_RESPONSE')
  return data as T
}
function queryString(input: VisualMaterialSearch | VisualMaterialList): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === '') continue
    if (key === 'tags' && Array.isArray(value)) for (const tag of value) params.append('tag', tag)
    else params.set(key, String(value))
  }
  return params.size ? `?${params.toString()}` : ''
}
export interface VisualMaterialApi {
  search(input: VisualMaterialSearch, signal: AbortSignal): Promise<VisualMaterialPage>
  owned(input: VisualMaterialList, signal: AbortSignal): Promise<VisualMaterialPage>
  quota(signal: AbortSignal): Promise<VisualMaterialQuota>
  describe(id: string, signal: AbortSignal): Promise<{ material: VisualMaterialDescriptor }>
  content(id: string, sha256: string, signal: AbortSignal): Promise<Blob>
  manage(id: string, input: ManageVisualMaterial, signal: AbortSignal): Promise<{ material: VisualMaterialDescriptor }>
}
export function createVisualMaterialApi(): VisualMaterialApi {
  const path = (id: string) => `/${encodeURIComponent(id)}`
  return {
    search: (input, signal) => request(queryString(input), signal),
    owned: (input, signal) => request(`/owned${queryString(input)}`, signal),
    quota: signal => request('/quota', signal),
    describe: (id, signal) => request(path(id), signal),
    content: async (id, sha256, signal) => {
      const response = await responseFor(`${path(id)}/content?sha256=${encodeURIComponent(sha256)}`, signal)
      if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'image/png') {
        throw new VisualMaterialApiError(502, 'INVALID_IMAGE')
      }
      const blob = await response.blob()
      if (blob.size === 0 || blob.size > 6 * 1024 * 1024) throw new VisualMaterialApiError(502, 'INVALID_IMAGE')
      return blob
    },
    manage: (id, input, signal) => request(path(id), signal, input),
  }
}
