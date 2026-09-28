// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminModelPoolTab } from '../src/client/AdminModelPoolTab.tsx'
import type {
  ModelPoolApi,
  ModelPoolProbeResult,
  ModelPoolState,
} from '../src/client/model-pool-api.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const t = (key: PhysicsosKey): string => zh[key] ?? key

const state = (): ModelPoolState => ({
  settings: {
    id: 'settings',
    retryCount: 2,
    failureThreshold: 3,
    cooldownBaseMs: 30_000,
    cooldownMaxMs: 1_800_000,
    autoRecover: true,
    updatedAt: '2026-09-26T00:00:00.000Z',
    updatedBy: 'PHYSICSOS-OPEN:admin',
  },
  channels: [
    {
      id: 'ch-1',
      name: '主通道',
      baseURL: 'https://api.example.com/v1',
      models: ['deepseek-v4.1-flash'],
      priority: 10,
      enabled: true,
      updatedAt: '2026-09-26T00:00:00.000Z',
      updatedBy: 'PHYSICSOS-OPEN:admin',
      keys: [
        {
          id: 'key-1',
          channelId: 'ch-1',
          label: '主力 key',
          keyTail: '4321',
          enabled: true,
          weight: 2,
          status: 'active',
          failCount: 0,
          cooldownUntil: null,
          lastError: null,
          lastUsedAt: null,
          requestCount: 7,
          failureCount: 1,
          failureRate: 1 / 8,
          updatedAt: '2026-09-26T00:00:00.000Z',
          updatedBy: 'PHYSICSOS-OPEN:admin',
        },
      ],
    },
  ],
  stats: {
    channels: 1,
    keys: 1,
    activeKeys: 1,
    cooldownKeys: 0,
    disabledKeys: 0,
  },
  audit: [],
  encryptionReady: true,
  proxy: { host: '127.0.0.1', port: 38972 },
})

const probe = (ok: boolean): ModelPoolProbeResult => ({
  ok,
  status: ok ? 200 : 401,
  latencyMs: ok ? 42 : 87,
  message: ok ? 'pong' : 'invalid api key',
})

const api = (): ModelPoolApi => ({
  state: vi.fn().mockResolvedValue(state()),
  createChannel: vi.fn().mockResolvedValue({ channel: state().channels[0] }),
  updateChannel: vi.fn().mockResolvedValue({ channel: state().channels[0] }),
  deleteChannel: vi.fn().mockResolvedValue({ ok: true }),
  addKey: vi.fn().mockResolvedValue({ key: state().channels[0]?.keys[0] }),
  updateKey: vi.fn().mockResolvedValue({ key: state().channels[0]?.keys[0] }),
  deleteKey: vi.fn().mockResolvedValue({ ok: true }),
  resetKey: vi.fn().mockResolvedValue({ key: state().channels[0]?.keys[0] }),
  testKey: vi.fn().mockResolvedValue(probe(true)),
  listChannelModels: vi.fn().mockResolvedValue({
    models: ['deepseek-v4.1-flash', 'deepseek-chat'],
    keyId: 'key-1',
  }),
  updateSettings: vi.fn().mockResolvedValue({ settings: state().settings }),
})

describe('AdminModelPoolTab', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders only the key tail and the live routing counters', async () => {
    render(<AdminModelPoolTab api={api()} t={t} />)
    await waitFor(() => { expect(screen.getByText('主通道')).toBeTruthy() })

    expect(screen.getByText('•••• 4321')).toBeTruthy()
    expect(screen.queryByText(/sk-super-secret/)).toBeNull()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('12.5%')).toBeTruthy()
  })

  it('creates a channel with parsed models and priority', async () => {
    const client = api()
    render(<AdminModelPoolTab api={client} t={t} />)
    await waitFor(() => { expect(screen.getByText('主通道')).toBeTruthy() })

    fireEvent.change(screen.getByLabelText('通道名称'), { target: { value: '备用通道' } })
    fireEvent.change(screen.getByLabelText('上游 Base URL'), {
      target: { value: 'https://backup.example.com/v1' },
    })
    fireEvent.change(screen.getByLabelText('模型列表'), {
      target: { value: 'deepseek-v4.1-flash, deepseek-chat' },
    })
    fireEvent.change(screen.getByLabelText('优先级'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(client.createChannel).toHaveBeenCalledWith({
        name: '备用通道',
        baseURL: 'https://backup.example.com/v1',
        models: ['deepseek-v4.1-flash', 'deepseek-chat'],
        priority: 20,
        enabled: true,
      })
    })
  })

  it('edits, resets, tests, and replaces a key without retaining plaintext', async () => {
    const client = api()
    vi.mocked(client.testKey).mockResolvedValue(probe(false))
    render(<AdminModelPoolTab api={client} t={t} />)
    await waitFor(() => { expect(screen.getByText('主通道')).toBeTruthy() })
    const row = screen.getByTestId('model-pool-key-key-1')

    fireEvent.click(within(row).getByRole('button', { name: '重置失败' }))
    await waitFor(() => { expect(client.resetKey).toHaveBeenCalledWith('key-1') })

    fireEvent.click(within(row).getByRole('button', { name: '测试此 key' }))
    await waitFor(() => { expect(screen.getByText(/测试失败/)).toBeTruthy() })

    fireEvent.click(within(row).getByRole('button', { name: '编辑' }))
    fireEvent.change(within(row).getByPlaceholderText('替换 key（留空表示不改）'), {
      target: { value: 'sk-replacement-9999' },
    })
    fireEvent.change(within(row).getByRole('spinbutton'), { target: { value: '5' } })
    fireEvent.click(within(row).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(client.updateKey).toHaveBeenCalledWith('key-1', {
        label: '主力 key',
        weight: 5,
        enabled: true,
        key: 'sk-replacement-9999',
      })
    })
    await waitFor(() => {
      expect(screen.queryByDisplayValue('sk-replacement-9999')).toBeNull()
    })
  })

  it("fetches a channel's upstream models and saves the ones the admin selects", async () => {
    const client = api()
    render(<AdminModelPoolTab api={client} t={t} />)
    await waitFor(() => { expect(screen.getByText('主通道')).toBeTruthy() })

    const card = screen.getByTestId('model-pool-channel-ch-1')
    /* The card head's 编辑 precedes the key row's, which is the only one in the
       card that opens the channel editor. */
    fireEvent.click(within(card).getAllByRole('button', { name: '编辑' })[0]!)
    fireEvent.click(within(card).getByRole('button', { name: '获取模型' }))

    await waitFor(() => { expect(client.listChannelModels).toHaveBeenCalledWith('ch-1') })
    const selected = await within(card).findByRole('button', { name: 'deepseek-v4.1-flash', pressed: true })
    expect(selected).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'deepseek-chat', pressed: false })).toBeTruthy()

    fireEvent.click(within(card).getByRole('button', { name: 'deepseek-chat' }))
    fireEvent.click(within(card).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(client.updateChannel).toHaveBeenCalledWith('ch-1', {
        name: '主通道',
        baseURL: 'https://api.example.com/v1',
        models: ['deepseek-v4.1-flash', 'deepseek-chat'],
        priority: 10,
        enabled: true,
      })
    })
  })

  it('shows the upstream refusal when the model list cannot be read', async () => {
    const client = api()
    vi.mocked(client.listChannelModels).mockRejectedValue(new Error('invalid api key'))
    render(<AdminModelPoolTab api={client} t={t} />)
    await waitFor(() => { expect(screen.getByText('主通道')).toBeTruthy() })

    const card = screen.getByTestId('model-pool-channel-ch-1')
    fireEvent.click(within(card).getAllByRole('button', { name: '编辑' })[0]!)
    fireEvent.click(within(card).getByRole('button', { name: '获取模型' }))

    await waitFor(() => { expect(within(card).getByText('invalid api key')).toBeTruthy() })
  })

  it('persists the routing policy as numbers', async () => {
    const client = api()
    render(<AdminModelPoolTab api={client} t={t} />)
    await waitFor(() => { expect(screen.getByText('主通道')).toBeTruthy() })

    fireEvent.change(screen.getByLabelText('额外重试次数'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('连续失败阈值'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('冷却基数（毫秒）'), { target: { value: '15000' } })
    fireEvent.change(screen.getByLabelText('冷却上限（毫秒）'), { target: { value: '60000' } })
    fireEvent.click(screen.getByLabelText('冷却到期后自动恢复'))
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }))

    await waitFor(() => {
      expect(client.updateSettings).toHaveBeenCalledWith({
        retryCount: 4,
        failureThreshold: 5,
        cooldownBaseMs: 15_000,
        cooldownMaxMs: 60_000,
        autoRecover: false,
      })
    })
  })
})
