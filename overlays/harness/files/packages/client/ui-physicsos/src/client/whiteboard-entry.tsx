import type { InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SnapshotStore } from './runtime-compat.ts'
import type { AuthController } from './auth-store.ts'
import type { PhysicsSurfaceController, PhysicsSurfaceState } from './surface-store.ts'
import { startCanvasNavigation } from './canvas/navigation.ts'
import { createWhiteboardController } from './whiteboard/controller.ts'
import { createWhiteboardHttpApi, createIndexedDbWhiteboardCache } from './whiteboard/persistence.ts'
import { WhiteboardSurface } from './whiteboard/WhiteboardSurface.tsx'
import { WhiteboardWorkspace } from './whiteboard/WhiteboardWorkspace.tsx'
import type { WhiteboardInjected } from './whiteboard/contract.ts'

interface EntryInjected extends WhiteboardInjected {
  readonly hooks: WhiteboardInjected['hooks'] & { readonly physicsSurface: SnapshotStore<PhysicsSurfaceState> }
}
type EntryProps = PropsRuntime<'main'> & PropsRenderFactories & PropsLocale<'physicsos'> & InjectFace<EntryInjected>
function Entry(props: EntryProps) {
  const state = props.usePhysicsSurface(value => value)
  if (state.surface !== 'whiteboard') return null
  return <WhiteboardSurface {...props} {...(state.whiteboardId === undefined ? {} : { whiteboardId: state.whiteboardId })} />
}

/** One board controller per client lifetime; account changes fence asynchronous work and drafts. */
export function registerWhiteboard(ctx: ClientContext, auth: AuthController, surface: PhysicsSurfaceController): void {
  const namespace = (): string | undefined => {
    const state = auth.store.getSnapshot()
    return state.status === 'authed' && state.user !== undefined
      ? `${encodeURIComponent(state.user.schoolId)}|${encodeURIComponent(state.user.id)}`
      : undefined
  }
  const controller = createWhiteboardController({
    api: createWhiteboardHttpApi({
      owner: () => {
        const state = auth.store.getSnapshot(),
          user = state.user
        return state.status === 'authed' && user !== undefined ? { schoolId: user.schoolId, username: user.username } : undefined
      },
    }),
    cache: createIndexedDbWhiteboardCache(),
    getNamespace: namespace,
  })
  const injected = (): EntryInjected => ({
    hooks: { whiteboardState: controller, physicsSurface: surface.store },
    whiteboardController: controller,
    openWhiteboardView: (id) => {
      if (id === undefined) controller.close()
      surface.openWhiteboard(id)
    },
    returnToExperiments: () => {
      surface.open('lab')
    },
  })
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: 'physicsos-whiteboard', locale: 'physicsos', inject: injected }, Entry),
  )
  ctx.slots.registerFactory(
    { name: 'physicsos.whiteboard.workspace', scope: 'root', locale: 'physicsos', inject: injected },
    WhiteboardWorkspace,
  )
  ctx.effect(() => {
    let account = namespace()
    const stop = auth.store.subscribe(() => {
      const current = namespace()
      if (current !== account) {
        account = current
        controller.resetNamespace()
      }
    })
    const stopNavigation = startCanvasNavigation(surface, window, 'whiteboard')
    return () => {
      stop()
      stopNavigation()
      controller.dispose()
    }
  }, 'ui-physicsos: whiteboard account and navigation')
}
