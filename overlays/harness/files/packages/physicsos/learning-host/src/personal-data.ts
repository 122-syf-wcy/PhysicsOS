/** Server-only account export and erasure over the already-open whiteboard and usage services. */
import type { WhiteboardService } from './whiteboard-service.ts'
import type { UsageService } from './usage-service.ts'
import { LearningError, type IdentityActor } from './identity.ts'
import type { PersonalErasureRequest } from './personal-fence.ts'

export const LEARNING_PERSONAL_DATA_SERVICE = 'physicsosLearningPersonalData'
interface AuthScope {
  accountResources(actor: IdentityActor): unknown
  resources(request: PersonalErasureRequest): unknown
}

export function createLearningPersonalData(whiteboard: WhiteboardService, usage: UsageService, lookup: (name: string) => unknown) {
  const auth = (): AuthScope => {
    const value = lookup('physicsosAccountErasureAuth') as Partial<AuthScope> | undefined
    if (!value || typeof value.accountResources !== 'function' || typeof value.resources !== 'function') {
      throw new LearningError(503, 'ACCOUNT_DATA_UNAVAILABLE', '账户数据校验服务未就绪')
    }
    return value as AuthScope
  }
  const read = async <T>(actor: IdentityActor, operation: () => Promise<T>): Promise<T> => {
    const scope = auth()
    scope.accountResources(actor)
    const value = await operation()
    if (auth() !== scope) throw new LearningError(503, 'ACCOUNT_DATA_UNAVAILABLE', '账户数据校验服务已变化')
    scope.accountResources(actor)
    return value
  }
  return {
    assertAvailable() { auth() },
    async prepareErasure(request: PersonalErasureRequest): Promise<void> {
      auth().resources(request)
      await whiteboard.prepareAccountErasure(request)
      auth().resources(request)
      await usage.prepareAccountErasure(request)
      auth().resources(request)
    },
    async eraseAccount(request: PersonalErasureRequest): Promise<void> {
      auth().resources(request)
      // The composite fences both whiteboard and Canvas before deleting their shared blob root.
      await whiteboard.eraseAccount(request)
      auth().resources(request)
      await usage.eraseAccount(request)
      auth().resources(request)
    },
    exportWhiteboardIndex: (actor: IdentityActor) => read(actor, () => whiteboard.exportIndex(actor)),
    exportWhiteboard: (actor: IdentityActor, id: string) => read(actor, () => whiteboard.exportItem(actor, id)),
    exportUsage: (actor: IdentityActor) => read(actor, () => usage.exportAccount(actor)),
  }
}
