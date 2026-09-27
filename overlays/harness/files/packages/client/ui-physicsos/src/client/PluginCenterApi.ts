/** Same-origin client for the SUPER_ADMIN plugin-center REST surface. */

export type PluginSource = 'official' | 'physicsos'
export type PluginCompatibility = 'compatible' | 'incompatible' | 'unknown'
export type PluginStatus = 'enabled' | 'disabled' | 'failed'
export type PluginIntegrity = 'verified' | 'missing'

export interface PluginCenterEntry {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly source: PluginSource
  readonly compatibility: PluginCompatibility
  readonly status: PluginStatus
  readonly capabilities: string[]
  readonly description?: string
  readonly publisher: string
  readonly harnessRange: string
  readonly integrity: PluginIntegrity
}

export interface PluginCenterState {
  readonly pinnedHarnessVersion: string
  readonly entries: PluginCenterEntry[]
  readonly updatedAt: string
}

export class PluginCenterApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PluginCenterApiError'
  }
}

const BASE = '/physicsos/plugins'

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    ...init,
  })
  const body = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new PluginCenterApiError(
      response.status,
      body.error?.code ?? `HTTP_${String(response.status)}`,
      body.error?.message ?? String(response.status),
    )
  }
  return body as T
}

export interface PluginCenterApi {
  state: () => Promise<PluginCenterState>
  setEnabled: (id: string, enabled: boolean) => Promise<{ entry: PluginCenterEntry }>
}

/** Concrete client bound to the current same-origin session. */
export function createPluginCenterApi(): PluginCenterApi {
  return {
    state: () => request('/state'),
    setEnabled: (id, enabled) => request(
      `/entries/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) },
    ),
  }
}
