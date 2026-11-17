import { useEffect, useSyncExternalStore } from 'react'
import type { PropsRuntime, PropsRenderFactories, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SnapshotStore } from '../runtime-compat.ts'
import type { AuthController } from '../auth-store.ts'
import { createCoursewareController, type CoursewareController } from './controller.ts'
import { createCoursewareHttpApi } from './api.ts'
import { createIndexedDbCoursewareCache } from './persistence.ts'
import { CoursewareSurface } from './CoursewareSurface.tsx'
interface CoursewareNavigationState { readonly surface: string; readonly coursewareId?: string | undefined }
export interface CoursewareSurfaceNavigation { readonly store: Pick<SnapshotStore<CoursewareNavigationState>, 'subscribe' | 'getSnapshot'>; openCourseware(id?: string): void; open(surface: 'lab'): void }
type EntryProps = PropsRuntime<'main'> & PropsRenderFactories & PropsLocale<'physicsos'>
/** Same-plugin entry. No imports of another feature plugin or Android/shared platform implementation. */
export function registerCourseware(ctx: ClientContext, auth: AuthController, surface: CoursewareSurfaceNavigation): CoursewareController {
  const namespace = (): string | undefined => { const state = auth.store.getSnapshot(); return state.status === 'authed' && state.user ? `${encodeURIComponent(state.user.schoolId)}|${encodeURIComponent(state.user.id)}` : undefined }
  let tab = 'primary'
  try { tab = sessionStorage.getItem('physicsos-courseware-tab') ?? crypto.randomUUID(); sessionStorage.setItem('physicsos-courseware-tab', tab) } catch { tab = `memory-${Date.now()}-${Math.random().toString(36).slice(2)}` }
  const controller = createCoursewareController({ api: createCoursewareHttpApi({ owner: () => { const state = auth.store.getSnapshot(); return state.status === 'authed' && state.user ? { schoolId: state.user.schoolId, username: state.user.username } : undefined } }), cache: createIndexedDbCoursewareCache(tab), getNamespace: namespace, getAccountKey: () => { const state = auth.store.getSnapshot(); return state.status === 'authed' && state.user ? `${state.user.schoolId}:${state.user.username}` : undefined } })
  function Entry(_props: EntryProps) {
    const navigation = useSyncExternalStore(surface.store.subscribe, surface.store.getSnapshot, surface.store.getSnapshot)
    useEffect(() => {
      if (navigation.surface === 'courseware') return
      controller.close()
    }, [navigation.surface])
    if (navigation.surface !== 'courseware') return null
    return <CoursewareSurface controller={controller} deckId={navigation.coursewareId} onOpenDeck={id => surface.openCourseware(id)} onClose={() => surface.open('lab')} />
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'physicsos-courseware', locale: 'physicsos' }, Entry))
  ctx.effect(() => {
    let account = namespace()
    const stop = auth.store.subscribe(() => { const next = namespace(); if (next !== account) { account = next; controller.resetNamespace() } })
    const online = (): void => { void controller.retry().catch(controller.reportError) }
    const visibility = (): void => { if (document.visibilityState === 'hidden') void controller.flush().catch(controller.reportError) }
    const beforeUnload = (event: BeforeUnloadEvent): void => { const current = controller.getSnapshot(); if (current.pendingOperationCount || current.unsafeDraftCount) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('online', online); window.addEventListener('beforeunload', beforeUnload); document.addEventListener('visibilitychange', visibility)
    return () => { stop(); window.removeEventListener('online', online); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', visibility); controller.dispose() }
  }, 'ui-physicsos: courseware account and drafts')
  return controller
}
export { CoursewareSurface } from './CoursewareSurface.tsx'
export { createCoursewareController } from './controller.ts'
export { createCoursewareHttpApi } from './api.ts'
export type { CoursewareApi } from './api.ts'
export type { CoursewareController } from './controller.ts'
export type { CoursewareSurfaceProps } from './CoursewareSurface.tsx'
