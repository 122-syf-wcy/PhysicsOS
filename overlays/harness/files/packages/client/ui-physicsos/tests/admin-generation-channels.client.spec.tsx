// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminGenerationChannelsTab } from '../src/client/AdminGenerationChannelsTab.tsx'
import { GenerationChannelApiError, type GenerationChannelApi, type GenerationPurpose, type GenerationState } from '../src/client/generation-channel-api.ts'

function state(): GenerationState {
  const scope = (purpose: GenerationPurpose) => ({ configRevision: `config-${purpose}`,
    settings: { id: purpose, retryCount: 2, failureThreshold: 3, cooldownBaseMs: 30000, cooldownMaxMs: 1800000,
      autoRecover: true, requestBudgetMs: 600000, attemptTimeoutMs: 120000, headersTimeoutMs: 60000, revision: 'r1' },
    channels: [{ id: `ch-${purpose}`, purpose, api: purpose === 'text' ? 'openai-responses' as const : 'openai-images' as const,
      name: `${purpose}-upstream`, baseURL: 'https://api.example.com', models: [{ id: purpose === 'text' ? 'gpt-6.2-sol' : 'gpt-image-2.5-sunburst' }],
      selectedModel: purpose === 'text' ? 'gpt-6.2-sol' : 'gpt-image-2.5-sunburst', priority: 50, enabled: true, revision: 'r1',
      keys: [{ id: `key-${purpose}`, channelId: `ch-${purpose}`, purpose, label: `${purpose}-account`, keyTail: '4321',
        enabled: true, weight: 1, status: 'cooldown' as const, cooldownUntil: 1800000000000,
        cooldownReason: 'rate-limited' as const, lastHttpStatus: 429, lastUsedAt: null, requestCount: 4, failureCount: 1, failureRate: 0.25 }] }],
    stats: { channels: 1, keys: 1, activeKeys: 0, cooldownKeys: 1, disabledKeys: 0 } })
  return { domain: 'physicsos_generation_channels', version: 0, encryptionReady: true, text: scope('text'), image: scope('image') }
}
function api(): GenerationChannelApi {
  return { state: vi.fn().mockResolvedValue(state()), createChannel: vi.fn().mockResolvedValue({ channel: state().text.channels[0] }),
    updateChannel: vi.fn().mockResolvedValue({ channel: state().text.channels[0] }), deleteChannel: vi.fn().mockResolvedValue({ ok: true }),
    addKey: vi.fn().mockResolvedValue({ key: state().text.channels[0]?.keys[0] }), updateKey: vi.fn().mockResolvedValue({ key: state().text.channels[0]?.keys[0] }),
    deleteKey: vi.fn().mockResolvedValue({ ok: true }), resetKey: vi.fn().mockResolvedValue({ key: state().text.channels[0]?.keys[0] }),
    listChannelModels: vi.fn().mockResolvedValue({ channelId: 'ch-text', purpose: 'text', keyId: 'key-text', models: ['gpt-6.2-sol', 'gpt-extra'], suggestedModels: ['gpt-6.2-sol'] }),
    updateSettings: vi.fn().mockResolvedValue({ settings: state().text.settings }) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('independent generation channel administration', () => {
  it('separates text and image pools, renders only masked credentials and explains the actual-main fallback', async () => {
    render(<AdminGenerationChannelsTab api={api()} language="en" />)
    await screen.findByText('text-upstream')
    await waitFor(() => { expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false) })
    expect(screen.getByText('•••• 4321')).toBeTruthy()
    expect(screen.getByText('HTTP 429')).toBeTruthy()
    expect(screen.getAllByText(/actual current-session main model/).length).toBeGreaterThan(0)
    expect(screen.queryByText('image-upstream')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Image channel' }))
    expect(screen.getByText('image-upstream')).toBeTruthy()
    expect(screen.queryByText('text-upstream')).toBeNull()
  })
  it('prefills only requested public text settings and creates structured model metadata', async () => {
    const client = api()
    render(<AdminGenerationChannelsTab api={client} language="en" />)
    await screen.findByText('text-upstream')
    await waitFor(() => { expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))
    const form = screen.getByRole('form', { name: 'Add channel' })
    expect(within(form).getByDisplayValue('https://ai.apizn.com')).toBeTruthy()
    expect(within(form).getByLabelText('Model ID')).toHaveProperty('value', 'gpt-6.2-sol')
    fireEvent.change(within(form).getByLabelText('Channel name'), { target: { value: 'Dedicated GPT' } })
    fireEvent.change(within(form).getByLabelText('Context window'), { target: { value: '200000' } })
    fireEvent.change(within(form).getByLabelText('Output limit'), { target: { value: '8192' } })
    fireEvent.change(within(form).getByLabelText('Reasoning effort mapping (optional JSON)'), { target: { value: '{"low":"low"}' } })
    fireEvent.submit(form)
    await waitFor(() => { expect(client.createChannel).toHaveBeenCalledWith({ purpose: 'text', api: 'openai-responses', name: 'Dedicated GPT',
      baseURL: 'https://ai.apizn.com', models: [{ id: 'gpt-6.2-sol', contextWindow: 200000, maxTokens: 8192, reasoningEfforts: { low: 'low' } }],
      selectedModel: 'gpt-6.2-sol', priority: 50, enabled: true }, expect.any(AbortSignal)) })
  })
  it('clears typed keys immediately on submit and never renders rejected secret-bearing errors', async () => {
    const client = api(), notify = vi.fn(), pending = Promise.withResolvers<{ key: GenerationState['text']['channels'][number]['keys'][number] }>()
    vi.mocked(client.addKey).mockReturnValue(pending.promise)
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    render(<AdminGenerationChannelsTab api={client} language="en" onNotify={notify} />)
    await screen.findByText('text-upstream')
    await waitFor(() => { expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
    const form = screen.getByRole('form', { name: 'Add key' }), field = within(form).getByLabelText('API Key') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'sk-never-store-this-key' } })
    fireEvent.submit(form)
    expect(field.value).toBe('')
    expect(storage).not.toHaveBeenCalled()
    await act(async () => { pending.reject(new Error('sk-never-store-this-key')); await pending.promise.catch(() => {}) })
    await screen.findByText('The operation did not complete. Retry.')
    expect(screen.queryByText('sk-never-store-this-key')).toBeNull()
    expect(notify).toHaveBeenCalledWith({ tone: 'error', message: 'The operation did not complete. Retry.' })
  })
  it('cancels a discovery request and ignores its late results before requesting again with a fresh signal', async () => {
    const client = api(), pending = Promise.withResolvers<Awaited<ReturnType<GenerationChannelApi['listChannelModels']>>>()
    vi.mocked(client.listChannelModels).mockReturnValueOnce(pending.promise)
    render(<AdminGenerationChannelsTab api={client} language="en" />)
    await screen.findByText('text-upstream')
    await waitFor(() => { expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Get models' }))
    const signal = vi.mocked(client.listChannelModels).mock.calls[0]?.[2]
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ channelId: 'ch-text', purpose: 'text', keyId: 'key-text', models: ['late-model'], suggestedModels: [] }); await pending.promise })
    expect(screen.queryByRole('button', { name: 'Add to model list: late-model' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Get models' }))
    await screen.findByRole('button', { name: 'Add to model list: gpt-extra' })
    expect(vi.mocked(client.listChannelModels).mock.calls[1]?.[2]).not.toBe(signal)
  })
  it('ignores a previous actor API response and keeps access failures explicit', async () => {
    const first = api(), second = api(), delayed = Promise.withResolvers<GenerationState>()
    vi.mocked(first.state).mockReturnValue(delayed.promise)
    vi.mocked(second.state).mockRejectedValue(new GenerationChannelApiError(403, 'FORBIDDEN'))
    const view = render(<AdminGenerationChannelsTab api={first} language="en" />)
    const signal = vi.mocked(first.state).mock.calls[0]?.[0]
    view.rerender(<AdminGenerationChannelsTab api={second} language="en" />)
    await screen.findByText('Only super administrators can manage generation channels')
    await act(async () => { delayed.resolve(state()); await delayed.promise })
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByText('text-upstream')).toBeNull()
  })
  it('scopes policy mutations to image without touching text settings', async () => {
    const client = api()
    render(<AdminGenerationChannelsTab api={client} language="en" />)
    await screen.findByText('text-upstream')
    await waitFor(() => { expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('tab', { name: 'Image channel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const form = screen.getByRole('form', { name: 'Independent retry and cooldown policy' })
    fireEvent.change(within(form).getByLabelText('Additional retries'), { target: { value: '1' } })
    fireEvent.submit(form)
    await waitFor(() => { expect(client.updateSettings).toHaveBeenCalledWith('image', expect.objectContaining({ retryCount: 1 }), expect.any(AbortSignal)) })
  })
})
