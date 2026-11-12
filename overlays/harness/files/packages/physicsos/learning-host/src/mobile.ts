/** Student-only facade over learning-host's existing service and private Canvas singleton. */
import { z } from 'zod'
import { LearningError, type IdentityActor } from './identity.ts'
import { LearningService, sceneSummary, type SceneMutation } from './service.ts'
import type { CanvasService } from './canvas-service.ts'

export const MOBILE_LEARNING_SERVICE = 'physicsosMobileLearning'
export interface AccountErasureRequest {
  readonly requestId: string
  readonly userId: string
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
}
const student = (actor: IdentityActor): void => {
  if (actor.role !== 'STUDENT') throw new LearningError(403, 'STUDENT_REQUIRED', '移动学习入口仅供学生本人使用')
  if (actor.userId === undefined || actor.userId.length === 0) throw new LearningError(401, 'UNAUTHENTICATED', '缺少有效账户实例')
}
const mutationWire = z.object({
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  restore: z.literal(true).optional(),
  checkpoint: z.record(z.string(), z.unknown()).optional(),
})
const mutationOf = (body: unknown, mutationId: string): SceneMutation => {
  const parsed = mutationWire.safeParse(body)
  if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '必须提供有效 baseRevision；新建为 0')
  if (parsed.data.checkpoint !== undefined && parsed.data.checkpoint['version'] !== 1) throw new LearningError(400, 'CHECKPOINT_VERSION', '仅支持完整 checkpoint version 1')
  return {
    baseRevision: parsed.data.baseRevision,
    ...(parsed.data.restore === undefined ? {} : { restore: parsed.data.restore }),
    ...(parsed.data.checkpoint === undefined ? {} : { checkpoint: parsed.data.checkpoint }),
    mutationId,
  }
}
const attemptView = (row: ReturnType<LearningService['allAttempts']>[number]) => {
  const { userKey: _user, schoolId: _school, ...item } = row
  return { ...item, revision: 1, gradingSource: 'self-reported' as const }
}

/** Construction accepts already-open services; it never creates a storage domain. */
export function createMobileLearning(service: LearningService, canvas: Pick<CanvasService, 'exportMetadata' | 'exportObjectIndex' | 'exportObject' | 'eraseAccount'>) {
  return {
    listAttempts(actor: IdentityActor) { student(actor); return service.allAttempts(actor).map(attemptView) },
    async saveAttempt(actor: IdentityActor, id: string, body: unknown) {
      student(actor)
      return { item: attemptView(await service.saveAttempt(actor, id, body)) }
    },
    listScenes(actor: IdentityActor) { student(actor); return service.allScenes(actor).map(sceneSummary) },
    async getScene(actor: IdentityActor, id: string) { student(actor); return { item: await service.openScene(actor, id) } },
    async exportScene(actor: IdentityActor, id: string, revision: number) { student(actor); return service.exportScene(actor, id, revision) },
    async saveScene(actor: IdentityActor, id: string, body: unknown, mutationId: string) {
      student(actor)
      const result = await service.saveMobileScene(actor, id, body, mutationOf(body, mutationId))
      return { ...result, item: sceneSummary(result.item) }
    },
    async deleteScene(actor: IdentityActor, id: string, body: unknown, mutationId: string) {
      student(actor)
      const parsed = z.object({ baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().safeParse(body)
      if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '删除必须提供 baseRevision')
      const result = await service.deleteMobileScene(actor, id, { ...parsed.data, mutationId })
      return { ...result, item: sceneSummary(result.item) }
    },
    async exportCanvasMetadata(actor: IdentityActor) { student(actor); return canvas.exportMetadata(actor) },
    async exportCanvasObjectIndex(actor: IdentityActor) { student(actor); return canvas.exportObjectIndex(actor) },
    async exportCanvasObject(actor: IdentityActor, id: string) { student(actor); return canvas.exportObject(actor, id) },
    async eraseAccount(request: AccountErasureRequest) {
      const actor: IdentityActor = { userKey: request.userKey, userId: request.userId, schoolId: request.schoolId, username: request.username, role: 'STUDENT' }
      await service.eraseAccount(actor, request)
      await canvas.eraseAccount(actor, request)
    },
  }
}
export type MobileLearningFacade = ReturnType<typeof createMobileLearning>
