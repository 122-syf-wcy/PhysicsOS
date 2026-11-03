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
}

export interface ContributionInput {
  readonly zipBase64: string
  readonly author: { name: string; bio?: string; github?: string; avatarDataUrl?: string }
  readonly note?: string
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
  const data = (await response.json()) as { error?: { message?: string } }
  if (!response.ok) throw new Error(data.error?.message ?? `请求失败（${response.status}）`)
  return data as T
}

export const contributionApi = {
  catalog: (): Promise<ContributionCatalog> => request('/convex-lens'),
  upload: (input: ContributionInput): Promise<{ item: ExperimentPackageView }> =>
    request('/convex-lens/packages', input),
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
  ): Promise<{ item: ExperimentPackageView }> =>
    request('/convex-lens/rollback', { packageId, expectedActiveId }),
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
