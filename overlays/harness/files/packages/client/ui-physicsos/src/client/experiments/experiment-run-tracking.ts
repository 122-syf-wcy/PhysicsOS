/** Host-session first-step tracking. No DOM click inference, iframe-authored success, scene data or persistent permit queue. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef } from 'react'
import type { AuthState } from '../auth-store.ts'
import type { SnapshotStore } from '../runtime-compat.ts'
import type { ExperimentSession } from './experiment-session.ts'
import { reportActivityDisplayed } from '../activity-telemetry.ts'
import { createExperimentRunApi, ExperimentRunApiError, experimentRunUuid, type ExperimentRunApi,
  type ExperimentRunCapabilities, type ExperimentRunExpectedOwner, type ExperimentRunPermit, type ExperimentRunPrepare } from './experiment-run-api.ts'

const MAX_PENDING_RUNS = 8, MAX_ATTACHMENTS = 32
interface PendingRun {
  readonly intent: number
  readonly input: ExperimentRunPrepare
  readonly abort: AbortController
  readonly timer: ReturnType<typeof setTimeout>
  readonly expires: number
  observed: boolean
  recording: boolean
  permit?: ExperimentRunPermit
}
export interface ExperimentRunTrackerOptions {
  readonly session: ExperimentSession
  readonly experimentId: string
  readonly owner: ExperimentRunExpectedOwner
  readonly api: ExperimentRunApi
  readonly capabilities: ExperimentRunCapabilities
  /** Local random display/owner generation. Never a scene id or a client grant of server authority. */
  readonly presentationGeneration: string
  readonly isCurrent: () => boolean
  readonly now?: () => number
  readonly makeRunId?: () => string
  readonly onIssue?: (code: string) => void
  readonly onCapabilityInvalid?: () => void
}
/** Testable controller. Each started intent gets ONE UUID, retained across at most two prepare/record attempts. */
export function createExperimentRunTracker(options: ExperimentRunTrackerOptions): { dispose(): void } {
  const pending = new Map<number, PendingRun>(), now = options.now ?? Date.now
  const owner = { ...options.owner }, presentation = options.presentationGeneration
  let stopped = false
  const issue = (code: string): void => { try { options.onIssue?.(code) } catch { /* Recording cannot affect playback. */ } }
  const enabled = options.capabilities.mode === 'enabled' && options.capabilities.recordingEnabled === true &&
    options.capabilities.capability === 'experiment-run-v1' && options.capabilities.schemaVersion === 1 &&
    options.capabilities.provenance === 'client-observed' && options.capabilities.boundary === 'platform-engine-first-step' &&
    options.capabilities.scope === 'lab-workspace' && experimentRunUuid(options.capabilities.capabilityGeneration) &&
    Number.isSafeInteger(options.capabilities.permitTtlMs) && options.capabilities.permitTtlMs > 0 && options.capabilities.permitTtlMs <= 300_000 &&
    experimentRunUuid(presentation) && /^[a-z0-9][a-z0-9-]{0,127}$/.test(options.experimentId) && owner.schoolId !== '' && owner.username !== ''
  const current = (): boolean => !stopped && enabled && options.isCurrent()
  const remove = (run: PendingRun): void => {
    if (pending.get(run.intent) !== run) return
    pending.delete(run.intent); clearTimeout(run.timer); run.abort.abort()
    delete run.permit
  }
  const live = (run: PendingRun): boolean => current() && pending.get(run.intent) === run && !run.abort.signal.aborted && now() < run.expires
  const retryable = (error: unknown): boolean => !(error instanceof ExperimentRunApiError) || error.retryable
  const invalidCapability = (error: unknown): void => {
    if (error instanceof ExperimentRunApiError && error.code === 'RUN_CAPABILITY_CHANGED') {
      try { options.onCapabilityInvalid?.() } catch { /* Fail closed until a future capability refresh. */ }
    }
  }
  const record = async (run: PendingRun): Promise<void> => {
    if (!live(run) || !run.observed || run.permit === undefined || run.recording) return
    run.recording = true
    const permit = run.permit
    try {
      for (let attempt = 0; attempt < 2 && live(run); attempt++) {
        if (Date.parse(permit.expiresAt) <= now()) return
        try { await options.api.record(permit, run.abort.signal); return }
        catch (error) {
          if (!live(run)) return
          invalidCapability(error)
          if (!retryable(error) || attempt === 1) { issue('EXPERIMENT_RUN_RECORD_FAILED'); return }
        }
      }
    } finally { remove(run) }
  }
  const prepare = async (run: PendingRun): Promise<void> => {
    for (let attempt = 0; attempt < 2 && live(run); attempt++) {
      try {
        const permit = await options.api.prepare(run.input, run.abort.signal)
        if (!live(run)) return
        if (permit.runId !== run.input.runId || permit.experimentId !== run.input.experimentId || permit.expectedCapabilityGeneration !== run.input.expectedCapabilityGeneration || !/^[A-Za-z0-9_-]{43}$/.test(permit.permit) || !Number.isFinite(Date.parse(permit.expiresAt)) || Date.parse(permit.expiresAt) <= now()) { issue('EXPERIMENT_RUN_PERMIT_INVALID'); remove(run); return }
        run.permit = { ...permit }
        if (run.observed) void record(run).catch(() => { remove(run) })
        return
      } catch (error) {
        if (!live(run)) return
        invalidCapability(error)
        if (!retryable(error) || attempt === 1) { issue('EXPERIMENT_RUN_PREPARE_FAILED'); remove(run); return }
      }
    }
  }
  const unsubscribe = options.session.subscribeRun(event => {
    if (event.source !== 'platform-engine') return
    if (!current()) { for (const run of pending.values()) remove(run); return }
    if (event.kind === 'started') {
      if (pending.has(event.intent)) return
      if (pending.size >= MAX_PENDING_RUNS) { issue('EXPERIMENT_RUN_CLIENT_LIMIT'); return }
      const runId = (options.makeRunId ?? randomUUID)()
      if (!experimentRunUuid(runId)) { issue('EXPERIMENT_RUN_CLIENT_ID_INVALID'); return }
      const abort = new AbortController(), expires = now() + options.capabilities.permitTtlMs
      const run: PendingRun = { intent: event.intent, input: { runId, experimentId: options.experimentId, expectedCapabilityGeneration: options.capabilities.capabilityGeneration },
        abort, expires, observed: false, recording: false, timer: setTimeout(() => { remove(run) }, options.capabilities.permitTtlMs) }
      pending.set(event.intent, run)
      void prepare(run).catch(() => { issue('EXPERIMENT_RUN_PREPARE_FAILED'); remove(run) })
    } else {
      const run = pending.get(event.intent)
      if (run === undefined) return
      if (event.kind === 'cancelled' && !run.observed) remove(run)
      else if (event.kind === 'first-step' && live(run)) {
        run.observed = true
        void record(run).catch(() => { issue('EXPERIMENT_RUN_RECORD_FAILED'); remove(run) })
      }
    }
  })
  return { dispose: () => { stopped = true; unsubscribe(); for (const run of pending.values()) remove(run) } }
}

type AuthStore = Pick<SnapshotStore<AuthState>, 'getSnapshot' | 'subscribe'>
interface Principal extends ExperimentRunExpectedOwner { readonly id: string }
interface PresentationToken { accountGeneration: string | undefined; readonly presentationId: string; reportedFor?: string }
interface DisplayGate { readonly ready: Set<PresentationToken>; revision: number }
interface Binding {
  readonly id: number
  readonly auth: AuthStore
  readonly options: ExperimentRunInstallationOptions
  epoch: number
  principal?: Principal
  api?: ExperimentRunApi
  capabilities?: ExperimentRunCapabilities
  capabilityAbort?: AbortController
  refresh(): void
  dispose(): void
}
export interface ExperimentRunInstallationOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly onIssue?: (code: string) => void
}
const gates = new WeakMap<ExperimentSession, DisplayGate>()
const notifications = new Set<() => void>()
const registrations = new WeakMap<ExperimentSession, { readonly experimentId: string; readonly current: Set<() => boolean>; release(): void }>()
let installed: Binding | undefined
let installationSequence = 0
const principal = (auth: AuthStore): Principal | undefined => {
  const state = auth.getSnapshot(), user = state.user
  return state.status === 'authed' && user !== undefined ? { id: user.id, schoolId: user.schoolId, username: user.username } : undefined
}
const principalKey = (value: Principal | undefined): string => value === undefined ? '' : JSON.stringify([value.id, value.schoolId, value.username])
const accountGeneration = (binding: Binding | undefined): string | undefined => binding?.principal === undefined ? undefined : JSON.stringify([binding.id, binding.epoch, principalKey(binding.principal)])
const readyFor = (gate: DisplayGate, binding: Binding): boolean => {
  const account = accountGeneration(binding)
  if (account === undefined) return false
  let ready = false
  for (const token of gate.ready) {
    // A display created while auth was loading may be claimed once, never rebound from one authenticated epoch to another.
    token.accountGeneration ??= account
    if (token.accountGeneration === account) ready = true
  }
  return ready
}
const notify = (): void => { for (const callback of notifications) { try { callback() } catch { /* An observer failure must not block authentication or playback. */ } } }
function gateOf(session: ExperimentSession): DisplayGate {
  let gate = gates.get(session)
  if (gate === undefined) { gate = { ready: new Set(), revision: 0 }; gates.set(session, gate) }
  return gate
}
/** Display readiness only gates FUTURE engine intents. It cannot emit a run, prepare or record by itself. */
export function bindExperimentRunPresentation(session: ExperimentSession): { setReady(value: boolean): void; isCurrent(): boolean; dispose(): void } {
  const gate = gateOf(session), token: PresentationToken = { accountGeneration: accountGeneration(installed), presentationId: randomUUID() }
  const update = (ready: boolean): void => {
    const before = gate.ready.has(token)
    if (ready) {
      token.accountGeneration ??= accountGeneration(installed)
      gate.ready.add(token)
    } else gate.ready.delete(token)
    if (before !== ready) { gate.revision++; notify() }
  }
  let disposed = false
  return {
    setReady: ready => { if (!disposed) update(ready) },
    isCurrent: () => !disposed && gate.ready.has(token) && installed !== undefined && token.accountGeneration !== undefined && token.accountGeneration === accountGeneration(installed),
    dispose: () => { if (disposed) return; disposed = true; update(false) },
  }
}
/** Main client index installs once with the real AuthStore; absent/loading/error/bridge never sends prepare or record. */
export function installExperimentRunTracking(auth: AuthStore, options: ExperimentRunInstallationOptions = {}): () => void {
  if (installed !== undefined) throw new Error('Experiment run tracking is already installed')
  const issue = (code: string): void => { try { options.onIssue?.(code) } catch { /* No app error from telemetry. */ } }
  let disposed = false, previous = ''
  const binding: Binding = {
    id: ++installationSequence, auth, options, epoch: 0,
    refresh: () => {
      binding.capabilityAbort?.abort(); delete binding.capabilities
      notify()
      const owner = binding.principal, api = binding.api, epoch = binding.epoch
      if (disposed || owner === undefined || api === undefined) return
      const abort = new AbortController(); binding.capabilityAbort = abort
      void api.capabilities(abort.signal).then(capabilities => {
        if (disposed || abort.signal.aborted || binding.epoch !== epoch || principalKey(principal(auth)) !== principalKey(owner)) return
        binding.capabilities = capabilities; notify()
      }, () => { if (!disposed && !abort.signal.aborted && binding.epoch === epoch) issue('EXPERIMENT_RUN_CAPABILITIES_UNAVAILABLE') })
    },
    dispose: () => { disposed = true; binding.epoch++; binding.capabilityAbort?.abort(); unsubscribe(); if (installed === binding) installed = undefined; notify() },
  }
  const observe = (): void => {
    const owner = principal(auth), key = principalKey(owner)
    if (key === previous) return
    previous = key; binding.epoch++; binding.capabilityAbort?.abort()
    delete binding.capabilities; delete binding.api; delete binding.principal
    if (owner !== undefined) { binding.principal = owner; binding.api = createExperimentRunApi({ owner, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }) }
    // Notify synchronously on account change: old requests abort before a late callback can be attributed to a new principal.
    notify(); binding.refresh()
  }
  const unsubscribe = auth.subscribe(observe)
  installed = binding; observe(); notify()
  return binding.dispose
}
/** One tracker per session even when more than one presentation subscribes. Only the Lab shell attaches this scope. */
export function attachExperimentRunTracking(session: ExperimentSession, experimentId: string, isCurrent: () => boolean = () => true): () => void {
  const existing = registrations.get(session)
  if (existing !== undefined) {
    if (existing.experimentId !== experimentId) return () => {}
    existing.current.add(isCurrent)
    return () => { existing.current.delete(isCurrent); if (existing.current.size === 0) existing.release() }
  }
  if (notifications.size >= MAX_ATTACHMENTS) return () => {}
  const current = new Set([isCurrent]), gate = gateOf(session)
  let tracker: { dispose(): void } | undefined, activeKey = '', released = false
  const reconcile = (): void => {
    const binding = installed, caps = binding?.capabilities, owner = binding?.principal
    const valid = !released && [...current].some(check => check()) && owner !== undefined && binding !== undefined && readyFor(gate, binding) && caps?.mode === 'enabled' && caps.recordingEnabled && binding.api !== undefined
    const key = valid ? JSON.stringify([binding!.id, binding!.epoch, principalKey(owner), caps!.capabilityGeneration, gate.revision]) : ''
    if (key === activeKey) return
    tracker?.dispose(); tracker = undefined; activeKey = key
    if (!valid || binding === undefined || caps === undefined || owner === undefined || binding.api === undefined) return
    for (const token of gate.ready) {
      const account = accountGeneration(binding)
      if (account !== undefined && token.accountGeneration === account && token.reportedFor !== account && typeof window !== 'undefined') {
        token.reportedFor = account
        reportActivityDisplayed('lab', token.presentationId, JSON.stringify([owner.schoolId, owner.username]))
      }
    }
    const capturedEpoch = binding.epoch, presentationRevision = gate.revision, ownerIdentity = principalKey(owner)
    tracker = createExperimentRunTracker({ session, experimentId, owner, api: binding.api, capabilities: caps, presentationGeneration: randomUUID(),
      isCurrent: () => installed === binding && binding.epoch === capturedEpoch && binding.capabilities?.capabilityGeneration === caps.capabilityGeneration &&
        principalKey(principal(binding.auth)) === ownerIdentity && gate.revision === presentationRevision && readyFor(gate, binding) && [...current].some(check => check()),
      onCapabilityInvalid: () => { if (installed === binding && binding.epoch === capturedEpoch && binding.capabilities?.capabilityGeneration === caps.capabilityGeneration) binding.refresh() },
      ...(binding.options.onIssue === undefined ? {} : { onIssue: binding.options.onIssue }),
    })
  }
  const release = (): void => { if (released) return; released = true; tracker?.dispose(); notifications.delete(reconcile); registrations.delete(session) }
  registrations.set(session, { experimentId, current, release }); notifications.add(reconcile); reconcile()
  return () => { current.delete(isCurrent); if (current.size === 0) release() }
}
export function useExperimentRunTracking(session: ExperimentSession, experimentId: string | undefined): void {
  const current = useRef({ session, experimentId })
  current.current = { session, experimentId }
  useEffect(() => experimentId === undefined ? undefined : attachExperimentRunTracking(session, experimentId,
    () => current.current.session === session && current.current.experimentId === experimentId), [session, experimentId])
}
/** The official host canvas is actually mounted. A loading/error placeholder never mounts this boundary. */
export function useExperimentRunPresentation(session: ExperimentSession): void {
  useEffect(() => {
    const display = bindExperimentRunPresentation(session)
    display.setReady(true)
    return display.dispose
  }, [session])
}
