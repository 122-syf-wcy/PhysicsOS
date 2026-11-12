/** Account-incarnation fences shared by the usage and whiteboard data owners. */
import { z } from 'zod'
import { LearningError } from './identity.ts'

export const personalErasureFence = z.strictObject({
  requestId: z.string().min(1).max(200),
  userId: z.string().min(1).max(512),
  userKey: z.string().min(1).max(200),
  schoolId: z.string().min(1).max(200),
  username: z.string().min(1).max(200),
  complete: z.boolean(),
})
export type PersonalErasureFence = z.infer<typeof personalErasureFence>
export type PersonalErasureRequest = Omit<PersonalErasureFence, 'complete'>
export interface PersonalOwner {
  readonly schoolId: string
  readonly userKey: string
  readonly userId?: string | undefined
}

export function checkPersonalFence(owner: PersonalOwner, fence: PersonalErasureFence | undefined): void {
  if (fence?.schoolId === owner.schoolId &&
    (!fence.complete || owner.userId === undefined || owner.userId === fence.userId)) {
    throw new LearningError(410, 'ACCOUNT_ERASED', '账户数据已删除或正在删除')
  }
}

export function checkErasureRequest(request: PersonalErasureRequest, fence?: PersonalErasureFence): void {
  if (!personalErasureFence.safeParse({ ...request, complete: false }).success) {
    throw new LearningError(400, 'ERASURE_IDENTITY_INVALID', '账户擦除身份无效')
  }
  if (fence !== undefined && (!fence.complete || fence.userId === request.userId) &&
    (fence.requestId !== request.requestId || fence.userId !== request.userId ||
      fence.userKey !== request.userKey || fence.schoolId !== request.schoolId || fence.username !== request.username)) {
    throw new LearningError(409, 'ERASURE_IDENTITY_CONFLICT', '账户擦除任务与实例不一致')
  }
}
