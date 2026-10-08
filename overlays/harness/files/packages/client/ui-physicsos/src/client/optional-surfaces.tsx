import type { PhysicsSurfaceProps } from './LabWorkspace.tsx'
import type { SceneChatCardProps, SceneCardBodyProps } from './SceneChatCard.tsx'
import type { AdminWorkspace } from './AdminWorkspace.tsx'
import type { ComponentProps } from 'react'
import { OptionalComponent } from './OptionalComponent.tsx'
import { loadWorkspaceModule, loadAdminModule } from './optional-modules.ts'

const loadSurface = async () => ({ default: (await loadWorkspaceModule()).PhysicsSurface })
const loadCard = async () => ({ default: (await loadWorkspaceModule()).SceneChatCard })
const loadBody = async () => ({ default: (await loadWorkspaceModule()).SceneCardBody })
const loadAdmin = async () => ({ default: (await loadAdminModule()).AdminWorkspace })

/** Registration remains small: physical runtimes load when a workspace or card is shown. */
export function OptionalPhysicsSurface(props: PhysicsSurfaceProps) {
  const surface = props.usePhysicsSurface(state => state.surface)
  if (surface === 'home') return null
  if (surface === 'admin') {
    if (props.adminApi === undefined) return null
    return <OptionalAdminWorkspace api={props.adminApi} useAuth={props.useAuth} t={props.t}
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

/** The turn-tail only mounts this after its published scene is present. */
export function OptionalSceneCardBody(props: SceneCardBodyProps) {
  return <OptionalComponent load={loadBody} componentProps={props} />
}
