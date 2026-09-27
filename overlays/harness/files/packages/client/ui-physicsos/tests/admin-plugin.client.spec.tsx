// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminPluginTab } from '../src/client/AdminPluginTab.tsx'
import { AdminWorkspace } from '../src/client/AdminWorkspace.tsx'
import {
  createPluginCenterApi,
  type PluginCenterApi,
  type PluginCenterEntry,
  type PluginCenterState,
} from '../src/client/PluginCenterApi.ts'
import type { AdminApi } from '../src/client/auth-api.ts'
import type { AuthState, AuthUser } from '../src/client/auth-store.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const entry = (over: Partial<PluginCenterEntry> = {}): PluginCenterEntry => ({
  id: 'official.example',
  name: 'Example official plugin',
  version: '1.2.3',
  source: 'official',
  compatibility: 'compatible',
  status: 'disabled',
  capabilities: ['tools.register', 'session.observe'],
  description: 'An official plugin.',
  publisher: 'DeepSeek',
  harnessRange: '=0.1.7-rc.2',
  integrity: 'verified',
  ...over,
})

const state = (entries: PluginCenterEntry[]): PluginCenterState => ({
  pinnedHarnessVersion: '0.1.7-rc.2',
  entries,
  updatedAt: '2026-09-27T10:00:00.000Z',
})

const stubApi = (entries: PluginCenterEntry[]) => {
  const getState = vi.fn().mockResolvedValue(state(entries))
  const setEnabled = vi.fn(async (id: string, enabled: boolean) => {
    const current = entries.find(candidate => candidate.id === id)
    if (current === undefined) throw new Error(`unknown plugin: ${id}`)
    return { entry: { ...current, status: enabled ? 'enabled' as const : 'disabled' as const } }
  })
  const api = { state: getState, setEnabled } as unknown as PluginCenterApi
  return { api, getState, setEnabled }
}

const mount = (entries: PluginCenterEntry[]) => {
  const stub = stubApi(entries)
  render(<AdminPluginTab api={stub.api} t={t} />)
  return stub
}

const user: AuthUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: '管理员',
  role: 'SUPER_ADMIN',
  schoolId: 'platform',
  schoolName: '平台',
  status: 'active',
}

const authedAs = (role: AuthUser['role']) =>
  <S,>(selector: (state: AuthState) => S): S =>
    selector({ status: 'authed', user: { ...user, role } })

const adminApi = {
  listUsers: async () => ({ users: [] }),
} as unknown as AdminApi

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AdminPluginTab', () => {
  it('renders official and PhysicsOS groups with capability labels before activation', async () => {
    mount([
      entry(),
      entry({
        id: '@deepseek-ai/dsh-tool-physicsos',
        name: 'PhysicsOS 物理工具',
        source: 'physicsos',
        capabilities: ['model.invoke'],
      }),
    ])

    await screen.findByTestId('plugin-group-official')
    expect(screen.getByTestId('plugin-group-physicsos')).toBeTruthy()
    expect(screen.getByTestId('plugin-group-official').textContent)
      .toContain(zh['admin.plugins.capability.tools.register'])
    expect(screen.getByTestId('plugin-group-physicsos').textContent)
      .toContain(zh['admin.plugins.capability.model.invoke'])
  })

  it('keeps an incompatible plugin disabled and never asks the server to enable it', async () => {
    const { setEnabled } = mount([
      entry({
        id: 'official.old',
        compatibility: 'incompatible',
        harnessRange: '<0.1.7',
      }),
    ])

    const toggle = await screen.findByTestId('plugin-toggle-official.old') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.textContent).toContain(zh['admin.plugins.enable'])
    fireEvent.click(toggle)
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it('enables a compatible plugin and updates the row from the server result', async () => {
    const { setEnabled } = mount([entry()])

    fireEvent.click(await screen.findByTestId('plugin-toggle-official.example'))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('official.example', true) })
    expect((await screen.findByTestId('plugin-status-official.example')).textContent)
      .toContain(zh['admin.plugins.status.enabled'])
  })

  it('filters between official and PhysicsOS groups', async () => {
    mount([
      entry(),
      entry({ id: '@deepseek-ai/dsh-tool-physicsos', name: 'PhysicsOS 物理工具', source: 'physicsos' }),
    ])
    await screen.findByTestId('plugin-group-official')

    fireEvent.click(screen.getByTestId('plugin-source-filter'))
    fireEvent.click(screen.getByRole('option', { name: zh['admin.plugins.source.physicsos'] }))

    expect(screen.queryByTestId('plugin-group-official')).toBeNull()
    expect(screen.getByTestId('plugin-group-physicsos')).toBeTruthy()
  })
})

describe('plugin-center administrator wiring', () => {
  it('offers the tab only to SUPER_ADMIN', async () => {
    const { api } = stubApi([entry()])
    const view = render(
      <AdminWorkspace
        api={adminApi}
        pluginApi={api}
        useAuth={authedAs('SUPER_ADMIN')}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: zh['admin.tab.plugins'] }))
    expect(await screen.findByTestId('plugin-group-official')).toBeTruthy()

    view.unmount()
    render(
      <AdminWorkspace
        api={adminApi}
        pluginApi={api}
        useAuth={authedAs('SCHOOL_ADMIN')}
        t={t}
      />,
    )
    expect(screen.queryByRole('tab', { name: zh['admin.tab.plugins'] })).toBeNull()
  })
})

describe('PluginCenterApi', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('reads the exact state route and patches an encoded plugin id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => state([entry()]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ entry: entry({ status: 'enabled' }) }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const api = createPluginCenterApi()
    await api.state()
    await api.setEnabled('@scope/plugin name', true)

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/physicsos/plugins/state', {
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/physicsos/plugins/entries/%40scope%2Fplugin%20name',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ enabled: true }),
      },
    )
  })
})
