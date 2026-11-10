import type { PhysicsSurfaceProps } from './LabWorkspace.tsx'
import type { SceneChatCardProps, SceneCardBodyProps } from './SceneChatCard.tsx'
import type { AdminWorkspace } from './AdminWorkspace.tsx'
import type { ComponentProps } from 'react'
import { OptionalComponent } from './OptionalComponent.tsx'
import { loadWorkspaceModule, loadAdminModule, loadCanvasModule } from './optional-modules.ts'
import type { CanvasOverlayProps, CanvasSurfaceProps, CanvasWorkbenchProps, CanvasFrameProps, CanvasInstanceProps } from './canvas/contract.ts'

const loadSurface = async () => ({ default: (await loadWorkspaceModule()).PhysicsSurface })
const loadCard = async () => ({ default: (await loadWorkspaceModule()).SceneChatCard })
const loadBody = async () => ({ default: (await loadWorkspaceModule()).SceneCardBody })
const loadAdmin = async () => ({ default: (await loadAdminModule()).AdminWorkspace })
const loadCanvasSurface = async () => ({ default: (await loadCanvasModule()).CanvasSurface })
const loadCanvasOverlay = async () => ({ default: (await loadCanvasModule()).CanvasOverlay })
const loadCanvasWorkspace = async () => ({ default: (await loadCanvasModule()).CanvasWorkspace })
const loadCanvasInstance = async () => ({ default: (await loadWorkspaceModule()).CanvasInstanceView })
const loadCanvasFrame = async () => ({ default: (await loadWorkspaceModule()).CanvasFrameStage })

/** Registration remains small: physical runtimes load when a workspace or card is shown. */
export function OptionalPhysicsSurface(props: PhysicsSurfaceProps) {
  const surface = props.usePhysicsSurface(state => state.surface)
  if (surface === 'home' || surface === 'canvas' || surface === 'whiteboard') return null
  if (surface === 'admin') {
    if (props.adminApi === undefined) return null
    return <OptionalAdminWorkspace api={props.adminApi} useAuth={props.useAuth} t={props.t}
      {...(props.usageApi === undefined ? {} : { usageApi: props.usageApi })}
      {...(props.paperApi === undefined ? {} : { paperApi: props.paperApi })}
      {...(props.noticeApi === undefined ? {} : { noticeApi: props.noticeApi })}
      {...(props.modelPoolApi === undefined ? {} : { modelPoolApi: props.modelPoolApi })} />
  }
  return <OptionalComponent load={loadSurface} componentProps={props} />
}

export function OptionalSceneChatCard(props: SceneChatCardProps) {
  return <OptionalComponent load={loadCard} componentProps={props} />
}

export function OptionalAdminWorkspace(props: ComponentProps<typeof AdminWorkspace>) {
  return <OptionalComponent load={loadAdmin} componentProps={props} />
}

export function OptionalCanvasSurface(props: CanvasSurfaceProps) {
  if (props.usePhysicsSurface(state => state.surface) !== 'canvas') return null
  return <OptionalComponent load={loadCanvasSurface} componentProps={props} />
}
export function OptionalCanvasOverlay(props: CanvasOverlayProps) {
  const active = props.usePhysicsSurface(state => state.surface === 'canvas')
  const requested = props.useStore(state => state.toast !== undefined || state.pendingSourceKey !== undefined)
  if (!active && !requested) return null
  return <OptionalComponent load={loadCanvasOverlay} componentProps={props} />
}
export function OptionalCanvasWorkspace(props: CanvasWorkbenchProps) {
  return <OptionalComponent load={loadCanvasWorkspace} componentProps={props} />
}
export function OptionalCanvasInstance(props: CanvasInstanceProps) {
  return <OptionalComponent load={loadCanvasInstance} componentProps={props} />
}
export function OptionalCanvasFrame(props: CanvasFrameProps) {
  return <OptionalComponent load={loadCanvasFrame} componentProps={props} />
}

/** The turn-tail only mounts this after its published scene is present. */
export function OptionalSceneCardBody(props: SceneCardBodyProps) {
  return <OptionalComponent load={loadBody} componentProps={props} />
}
