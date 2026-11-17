import { useCallback, useEffect, useRef, useState } from 'react'
import { collectLearningPages, type ProductLifecycle, type ProjectProductState } from './learning-api.ts'
import type { ProjectStateBridge } from './StudyProjects.tsx'

const emptyHeads: ReadonlyMap<string, ProjectProductState> = new Map()
interface ProjectWorkspaceView<T> {
  readonly items: readonly T[]
  readonly state: 'idle' | 'loading' | 'ready' | 'error'
  readonly heads: ReadonlyMap<string, ProjectProductState>
  refresh(): void
  acknowledge(head: ProjectProductState, account: string): void
}

/** Local picker projection only. Native registry and retained session grouping are never removed. */
export function useProjectWorkspaceRows<T extends { readonly workspaceId: string }>(
  items: readonly T[], state: 'idle' | 'loading' | 'ready' | 'error', bridge?: ProjectStateBridge,
  lifecycle: ProductLifecycle = 'live',
): ProjectWorkspaceView<T> {
  const [revision, setRevision] = useState(0)
  const [projection, setProjection] = useState<{ account: string; heads: ReadonlyMap<string, ProjectProductState>; status: 'loading' | 'ready' | 'error' }>()
  const requestEpoch = useRef(0)
  const account = bridge?.accountKey()
  const readable = bridge?.readable?.() ?? bridge?.enabled() ?? false
  const capabilityReady = bridge?.ready?.() ?? true
  const refresh = useCallback((): void => { requestEpoch.current++; setRevision(value => value + 1) }, [])
  useEffect(() => bridge?.subscribe(refresh), [bridge, refresh])
  useEffect(() => {
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [refresh])
  useEffect(() => {
    let stale = false
    const epoch = requestEpoch.current
    if (!bridge || !readable || !account) { setProjection(undefined); return }
    setProjection({ account, heads: emptyHeads, status: 'loading' })
    void collectLearningPages(cursor => bridge.api.listProjectStates({ state: 'all', limit: 100, ...(cursor === undefined ? {} : { cursor }) })).then(states => {
      if (stale || epoch !== requestEpoch.current || bridge.accountKey() !== account) return
      setProjection({ account, heads: new Map(states.map(head => [head.projectId, head])), status: 'ready' })
    }).catch(() => {
      if (!stale && epoch === requestEpoch.current && bridge.accountKey() === account) setProjection({ account, heads: emptyHeads, status: 'error' })
    })
    return () => { stale = true }
  }, [bridge, account, readable, revision, items])
  const acknowledge = (head: ProjectProductState, expectedAccount: string): void => {
    if (!bridge || bridge.accountKey() !== expectedAccount || account !== expectedAccount) return
    setProjection(current => {
      if (!current || current.account !== expectedAccount || current.status !== 'ready') return current
      const previous = current.heads.get(head.projectId)
      if (previous && (previous.version > head.version || previous.generation > head.generation)) return current
      return { ...current, heads: new Map([...current.heads, [head.projectId, head]]) }
    })
  }
  const response = (visible: readonly T[], status: ProjectWorkspaceView<T>['state'], heads = emptyHeads): ProjectWorkspaceView<T> => ({ items: visible, state: status, heads, refresh, acknowledge })
  if (!bridge) return response(lifecycle === 'live' ? items : [], state)
  if (!account || !capabilityReady) return response([], 'loading')
  if (!readable) return response(lifecycle === 'live' ? items : [], state)
  if (!projection || projection.account !== account || projection.status === 'loading') return response([], 'loading')
  if (projection.status === 'error') return response([], 'error')
  return response(items.filter(item => projection.heads.get(item.workspaceId)?.state === lifecycle), state, projection.heads)
}
