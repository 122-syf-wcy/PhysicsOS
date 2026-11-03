import type { PhysicsScene } from '@physicsos/physics-scene'

type ReleaseIdentity = NonNullable<PhysicsScene['metadata']['experimentRelease']>

export interface ContributionAuthor {
  readonly name: string
  readonly bio?: string
  readonly github?: string
  readonly avatarUrl?: string
}

export interface ExperimentPackageView {
  readonly id: string
  readonly experimentId: string
  readonly version: string
  readonly schemaVersion?: 1 | 2 | 3
  readonly protocolVersion?: 1 | 2 | 3
  readonly sha256: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly author: ContributionAuthor
  readonly note?: string
  readonly createdAt: string
  readonly publishedAt?: string
  readonly rejectionReason?: string
  readonly entryUrl?: string
}

export interface ContributionCatalog {
  readonly active: ExperimentPackageView | null
  readonly items: readonly ExperimentPackageView[]
  readonly canReview: boolean
  readonly activeByExperiment?: Readonly<Record<string, ExperimentPackageView | null>>
}

export interface ContributionInput {
  readonly zipBase64: string
  readonly author: { name: string; bio?: string; github?: string; avatarDataUrl?: string }
  readonly note?: string
}

/** Bundled renderers have a distinct identity; never invent a content hash for them. */
export function contributionReleaseIdentity(item: ExperimentPackageView | null, experimentId = 'convex-lens'): ReleaseIdentity {
  return item === null
    ? {
      kind: 'official',
      id: `physicsos-${experimentId}-v1`,
      experimentId,
      version: '1.0.0',
    }
    : {
      kind: 'community',
      id: item.id,
      experimentId: item.experimentId,
      version: item.version,
      sha256: item.sha256,
    }
}

export function selectContributionRelease(
  catalog: ContributionCatalog,
  pinned?: ReleaseIdentity,
  experimentId = 'convex-lens',
): ExperimentPackageView | null | undefined {
  if (pinned !== undefined && pinned.experimentId !== experimentId) return undefined
  if (pinned?.kind === 'official') return null
  if (pinned === undefined) return catalog.active === null ? null : catalog.active.experimentId === experimentId && catalog.active.status === 'approved' ? catalog.active : undefined
  return catalog.items.find(item => item.id === pinned.id && item.sha256 === pinned.sha256 && item.experimentId === experimentId && item.status === 'approved')
}

/** Approved assets are public; only drafts require the owner/admin preview capability. */
export async function contributionPreviewUrl(item: ExperimentPackageView): Promise<string> {
  if (item.status === 'approved' && item.entryUrl) return item.entryUrl
  return (await contributionApi.preview(item.id)).entryUrl
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/physicsos/experiments${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  })
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    if (response.status === 401) throw new Error('请先登录，再上传或查看实验投稿。')
    if (response.status === 404) throw new Error('实验上传服务暂不可用，请稍后刷新重试。')
    const error =
      data !== null && typeof data === 'object' && 'error' in data ? data.error : undefined
    const message =
      error !== null &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message
        : `请求失败（${response.status}），请重试。`
    const issues =
      error !== null &&
      typeof error === 'object' &&
      'issues' in error &&
      Array.isArray(error.issues)
        ? error.issues.slice(0, 20)
        : []
    const bounded = (value: unknown, limit: number): string =>
      typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : ''
    const details = issues.flatMap((issue: unknown) => {
      if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) return []
      const fields = issue as Record<string, unknown>
      const file = bounded(fields.file, 120),
        path = bounded(fields.path, 160)
      const suggestion = bounded(fields.suggestion, 300)
      return file && path && suggestion ? [`${file} · ${path}：${suggestion}`] : []
    })
    throw new Error([bounded(message, 500), ...details].join('\n'))
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw new Error('实验上传服务返回了无效响应，请刷新重试。')
  return data as T
}

export const contributionApi = {
  registry: (): Promise<{ items: readonly { id: string; label: string; domain: string }[] }> => request('/catalog'),
  reviewQueue: (): Promise<ContributionCatalog> => request<Omit<ContributionCatalog, 'active'>>('/review-queue').then(data => ({ ...data, active: null })),
  catalog: (experimentId = 'convex-lens'): Promise<ContributionCatalog> =>
    request(`/${encodeURIComponent(experimentId)}`),
  upload: (input: ContributionInput, experimentId = 'convex-lens'): Promise<{ item: ExperimentPackageView }> =>
    request(`/${encodeURIComponent(experimentId)}/packages`, input),
  preview: (id: string): Promise<{ entryUrl: string }> =>
    request(`/packages/${encodeURIComponent(id)}/preview`),
  review: (
    item: ExperimentPackageView,
    action: 'approve' | 'reject',
    reason?: string,
  ): Promise<{ item: ExperimentPackageView }> =>
    request(`/packages/${encodeURIComponent(item.id)}/review`, {
      action,
      expectedSha256: item.sha256,
      ...(reason === undefined ? {} : { reason }),
    }),
  rollback: (
    packageId: string,
    expectedActiveId: string,
    experimentId = 'convex-lens',
  ): Promise<{ item: ExperimentPackageView }> =>
    request(`/${encodeURIComponent(experimentId)}/rollback`, { packageId, expectedActiveId }),
}

/** Browser file bytes, bounded before a potentially large allocation. */
export function contributionFileData(file: File, limit: number): Promise<string> {
  if (file.size === 0 || file.size > limit)
    return Promise.reject(new Error('文件为空或超过大小限制'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('无法读取文件，请重新选择'))
    }
    reader.onabort = () => {
      reject(new Error('文件读取已取消'))
    }
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取文件'))
    }
    reader.readAsDataURL(file)
  })
}
