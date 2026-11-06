import { useCallback, useEffect, useMemo, useState } from 'react'
import { contributionApi, contributionReleaseIdentity, type ExperimentPackageView } from './contribution-api.ts'
import type { CommunityFrameStatus } from './CommunityExperimentFrame.tsx'
import type { ExperimentSession } from './experiment-session.ts'

const pinKey = (session: ExperimentSession): string => {
  const pin = session.getScene()?.metadata.experimentRelease
  return JSON.stringify(pin === undefined ? null
    : [pin.kind, pin.experimentId, pin.id, pin.version, pin.kind === 'community' ? pin.sha256 : undefined])
}
function newerAppearance(active: ExperimentPackageView | null, session: ExperimentSession, experimentId: string) {
  const pin = session.getScene()?.metadata.experimentRelease
  if (!pin || pin.experimentId !== experimentId || !active || active.experimentId !== experimentId
    || active.status !== 'approved' || active.protocolVersion !== 3 || !active.entryUrl
    || !active.sha256 || active.id === pin.id || (pin.kind === 'community' && active.sha256 === pin.sha256)) return null
  const version = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : []
  const before = version(pin.version), after = version(active.version)
  if (before.length !== 3 || after.length !== 3 || ![...before, ...after].every(Number.isSafeInteger)) return null
  for (let index = 0; index < 3; index++) {
    const next = after[index], previous = before[index]
    if (next === undefined || previous === undefined) return null
    if (next > previous) return active
    if (next < previous) return null
  }
  return null
}

/** A personal appearance change is saved only after its exact package has rendered. */
export function useExperimentAppearance(session: ExperimentSession, experimentId: string) {
  const scope = useMemo(() => ({ alive: true, busy: false, sequence: 0, pendingId: '' }), [session, experimentId])
  const empty = useCallback(() => ({ scope, available: null as ExperimentPackageView | null,
    pending: null as ExperimentPackageView | null, applied: null as ExperimentPackageView | null,
    checking: false, error: '', from: '' }), [scope])
  const [state, setState] = useState(empty)
  const current = state.scope === scope ? state : empty()
  useEffect(() => {
    scope.alive = true
    return () => { scope.alive = false; scope.sequence++ }
  }, [scope])
  const offer = useCallback((active: ExperimentPackageView | null) => {
    if (!scope.alive) return
    const available = newerAppearance(active, session, experimentId)
    setState(previous => ({ ...(previous.scope === scope ? previous : empty()), available }))
  }, [scope, session, experimentId, empty])
  const start = async (): Promise<void> => {
    const candidate = current.available
    if (!candidate || scope.busy) return
    scope.busy = true
    const sequence = ++scope.sequence, from = pinKey(session)
    setState({ ...current, checking: true, error: '', from })
    try {
      const catalog = await contributionApi.catalog(experimentId)
      if (!scope.alive || sequence !== scope.sequence) return
      const confirmed = newerAppearance(catalog.active, session, experimentId)
      if (pinKey(session) !== from || !confirmed || confirmed.id !== candidate.id || confirmed.sha256 !== candidate.sha256) {
        scope.busy = false
        setState(previous => ({ ...previous, available: confirmed, checking: false,
          error: '可用外观已更新，当前实验已保留，请重试。' }))
        return
      }
      scope.pendingId = confirmed.id
      setState(previous => ({ ...previous, pending: confirmed, checking: false }))
    } catch {
      if (scope.alive && sequence === scope.sequence) {
        scope.busy = false
        setState(previous => ({ ...previous, checking: false, error: '新版外观暂时无法载入，当前实验已保留，请重试。' }))
      }
    }
  }
  const onStatus = (id: string, status: CommunityFrameStatus): void => {
    const pending = current.pending
    if (!scope.alive || !pending || pending.id !== id || scope.pendingId !== id || status === 'loading') return
    scope.pendingId = ''
    scope.busy = false
    if (status === 'ready' && pinKey(session) === current.from) {
      session.setRelease(contributionReleaseIdentity(pending, experimentId))
      setState({ ...current, applied: pending, pending: null, available: null, checking: false, error: '' })
    } else {
      setState({ ...current, pending: null, checking: false, error: '新版外观未能显示，已恢复原实验外观，请重试。' })
    }
  }
  return { available: current.available, pending: current.pending, applied: current.applied,
    busy: current.checking || current.pending !== null, error: current.error, offer, start, onStatus }
}
