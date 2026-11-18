import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CodeModelRouting, mainModelForVisualization, type VisualizationChannels } from '../src/code-model-routing.ts'

function parentFixture(pending: unknown = null) {
  let header = { provider: 'main-provider', model: 'main-model' }
  const parent = {
    id: 'owned-main-session', options: { provider: 'creation-provider', model: 'creation-model' },
    session: { requestHeader: () => ({ config: header }) },
    ctx: { get: (name: string) => name === 'sessionProjections' ? { stateOf: () => ({ pending }) } : undefined },
  } as unknown as Agent
  return { parent, setHeader: (next: typeof header) => { header = next } }
}
function channelFixture() {
  let outcome: ReturnType<VisualizationChannels['textOutcome']>
  const channels: VisualizationChannels = {
    acquireTextRoute: vi.fn(async () => ({ status: 'ready', provider: 'visualization-provider', model: 'private-model-lease', routeId: 'route-1', actualModel: 'gpt-6.2-sol', configRevision: 'revision-1' })),
    textOutcome: () => outcome,
    releaseTextRoute: vi.fn(),
    recordMainFallback: vi.fn(),
  }
  return { channels, setOutcome: (next: typeof outcome) => { outcome = next } }
}
function signal() {
  const controller = new AbortController()
  onTestFinished(() => controller.abort())
  return controller
}

describe('job-owned visualization model routing', () => {
  it('inherits the effective main request rather than the agent creation default', () => {
    expect(mainModelForVisualization(parentFixture().parent)).toEqual({ provider: 'main-provider', model: 'main-model' })
  })
  it('uses a server-persisted unconsumed model-picker selection on page regeneration', () => {
    expect(mainModelForVisualization(parentFixture({ provider: 'picked-provider', model: 'picked-model' }).parent)).toEqual({ provider: 'picked-provider', model: 'picked-model' })
    expect(mainModelForVisualization(parentFixture({ provider: 'incomplete-picker' }).parent)).toEqual({ provider: 'main-provider', model: 'main-model' })
  })
  it('falls back when no independent channel service is configured', async () => {
    const router = new CodeModelRouting(() => undefined), control = signal()
    expect(await router.resolve(parentFixture().parent, 'owned-job', control.signal)).toEqual({ provider: 'main-provider', model: 'main-model', actualModel: 'main-model', source: 'main', fallbackReason: 'unconfigured' })
  })
  it('records an explicit unconfigured decision without invoking an unrelated model', async () => {
    const { channels } = channelFixture()
    channels.acquireTextRoute = vi.fn(async () => ({ status: 'unconfigured' }))
    const router = new CodeModelRouting(() => channels), control = signal()
    const decision = await router.resolve(parentFixture().parent, 'owned-job', control.signal)
    expect(decision.source).toBe('main')
    expect(channels.recordMainFallback).toHaveBeenCalledWith({ requestId: 'owned-job', provider: 'main-provider', model: 'main-model', reason: 'unconfigured' })
  })
  it('singleflights and freezes the dedicated lease and initiating main route across repair', async () => {
    const { channels, setOutcome } = channelFixture(), f = parentFixture(), control = signal()
    const router = new CodeModelRouting(() => channels)
    const [one, two] = await Promise.all([router.resolve(f.parent, 'owned-job', control.signal), router.resolve(f.parent, 'owned-job', control.signal)])
    expect(one).toBe(two)
    expect(channels.acquireTextRoute).toHaveBeenCalledTimes(1)
    expect(one).toMatchObject({ source: 'dedicated', actualModel: 'gpt-6.2-sol', configRevision: 'revision-1' })
    f.setHeader({ provider: 'later-main', model: 'later-model' })
    setOutcome({ kind: 'rate-limited', allAccountsRateLimited: true })
    expect(router.reviewRateLimit('owned-job')).toBe(true)
    expect(await router.resolve(f.parent, 'owned-job', control.signal)).toMatchObject({ provider: 'main-provider', model: 'main-model', source: 'main', fallbackReason: 'all-http429' })
    expect(channels.acquireTextRoute).toHaveBeenCalledTimes(1)
  })
  it.each(['auth', 'transport', 'server', 'client', 'partial-exhausted'])('does not switch models for %s failures', async kind => {
    const { channels, setOutcome } = channelFixture(), router = new CodeModelRouting(() => channels), control = signal()
    const original = await router.resolve(parentFixture().parent, 'owned-job', control.signal)
    setOutcome({ kind, allAccountsRateLimited: false })
    expect(router.reviewRateLimit('owned-job')).toBe(false)
    expect(await router.resolve(parentFixture().parent, 'owned-job', control.signal)).toBe(original)
    expect(channels.recordMainFallback).not.toHaveBeenCalled()
  })
  it('does not call the last attempted key proof all-account rate limiting', async () => {
    const { channels, setOutcome } = channelFixture(), router = new CodeModelRouting(() => channels), control = signal()
    await router.resolve(parentFixture().parent, 'owned-job', control.signal)
    setOutcome({ kind: 'rate-limited', allAccountsRateLimited: false })
    expect(router.reviewRateLimit('owned-job')).toBe(false)
  })
  it('refuses an alternate parent trying to reuse the same job request key', async () => {
    const router = new CodeModelRouting(() => undefined), control = signal()
    await router.resolve(parentFixture().parent, 'owned-job', control.signal)
    const other = { ...parentFixture().parent, id: 'foreign-main-session' } as unknown as Agent
    await expect(router.resolve(other, 'owned-job', control.signal)).rejects.toMatchObject({ code: 'STALE_GENERATION' })
  })
  it('releases the exact lease if acquisition finishes after cancellation', async () => {
    const { channels } = channelFixture(), control = signal()
    let release!: (route: Awaited<ReturnType<VisualizationChannels['acquireTextRoute']>>) => void
    let enter!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const waiting = new Promise<Awaited<ReturnType<VisualizationChannels['acquireTextRoute']>>>(resolve => { release = resolve })
    channels.acquireTextRoute = async () => { enter(); return waiting }
    const router = new CodeModelRouting(() => channels), request = router.resolve(parentFixture().parent, 'owned-job', control.signal)
    const cancelled = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await entered
    control.abort()
    release({ status: 'ready', provider: 'visualization-provider', model: 'private-model-lease', routeId: 'late-route', actualModel: 'gpt-6.2-sol', configRevision: 'revision-1' })
    await cancelled
    expect(channels.releaseTextRoute).toHaveBeenCalledWith('late-route')
    expect(channels.recordMainFallback).not.toHaveBeenCalled()
  })
  it('expires only a held job using the injected clock, without reopening its old route', async () => {
    let now = 0
    const { channels } = channelFixture(), router = new CodeModelRouting(() => channels, () => now), control = signal()
    await router.resolve(parentFixture().parent, 'expired-job', control.signal)
    now = 20 * 60_000 + 1
    await router.resolve(parentFixture().parent, 'new-job', control.signal)
    expect(channels.releaseTextRoute).toHaveBeenCalledWith('route-1')
    expect(channels.acquireTextRoute).toHaveBeenCalledTimes(2)
  })
})
