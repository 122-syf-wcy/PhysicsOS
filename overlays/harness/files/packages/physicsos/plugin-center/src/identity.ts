import type { IncomingMessage } from 'node:http'
import type { PluginActor } from './catalog.ts'

export const IDENTITY_SERVICE = 'physicsosIdentity'

export interface PhysicsosIdentity {
  actorOf(req: IncomingMessage): PluginActor | null
  record(
    actor: PluginActor,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void>
}

export class PluginRoutesError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PluginRoutesError'
  }
}

export const identityOf = (
  ctx: { get(name: string): unknown },
): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : service as PhysicsosIdentity
}

export const requireSuperAdmin = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
): PluginActor => {
  if (identity === undefined) {
    throw new PluginRoutesError(503, 'IDENTITY_UNAVAILABLE', '身份服务尚未就绪')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new PluginRoutesError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  if (actor.role !== 'SUPER_ADMIN') {
    throw new PluginRoutesError(403, 'FORBIDDEN', '只有平台管理员可以管理插件中心')
  }
  return actor
}
