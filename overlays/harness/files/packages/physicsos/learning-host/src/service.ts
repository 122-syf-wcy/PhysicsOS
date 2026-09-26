/**
 * Personal learning rules. Every lookup is keyed by the server-resolved
 * user key, and every row is checked against both that key and its tenant
 * before it is returned. No method accepts a school or account from the wire.
 */

import { LearningError, type IdentityActor } from './identity.ts'
import {
  attemptKey,
  attemptWire,
  savedSceneKey,
  sceneEntryWire,
  type LearningDomain,
  type PersonalAttemptRecord,
  type SavedSceneRecord,
} from './domain.ts'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const MAX_SCENE_BYTES = 256 * 1024
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/

export interface Page<T> {
  readonly items: T[]
  readonly nextCursor?: string
}

export interface ListQuery {
  readonly limit?: string
  readonly cursor?: string
}

interface Cursor {
  readonly version: 1
  readonly primary: string
  readonly key: string
}

const encodeCursor = (primary: string, key: string): string =>
  Buffer.from(JSON.stringify({ version: 1, primary, key } satisfies Cursor), 'utf8').toString(
    'base64url',
  )

const decodeCursor = (value: string): Cursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    if (
      parsed.version !== 1 ||
      typeof parsed.primary !== 'string' ||
      typeof parsed.key !== 'string' ||
      parsed.primary.length > 64 ||
      parsed.key.length > 128
    ) {
      throw new Error('bad cursor')
    }
    return { version: 1, primary: parsed.primary, key: parsed.key }
  } catch {
    throw new LearningError(400, 'BAD_CURSOR', '分页游标无效')
  }
}

const pageSize = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_PAGE_SIZE
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new LearningError(
      400,
      'BAD_REQUEST',
      `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    )
  }
  return parsed
}

const pageOf = <T>(
  rows: readonly T[],
  query: ListQuery,
  primaryOf: (row: T) => string,
  keyOf: (row: T) => string,
): Page<T> => {
  const limit = pageSize(query.limit)
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
  const ordered = [...rows].sort(
    (a, b) => primaryOf(b).localeCompare(primaryOf(a)) || keyOf(b).localeCompare(keyOf(a)),
  )
  let remaining = ordered
  if (cursor !== undefined) {
    remaining = ordered.filter((row) => {
      const primary = primaryOf(row)
      const key = keyOf(row)
      return primary < cursor.primary || (primary === cursor.primary && key < cursor.key)
    })
  }
  const items = remaining.slice(0, limit)
  const last = items.at(-1)
  if (last === undefined || remaining.length <= limit) return { items }
  return { items, nextCursor: encodeCursor(primaryOf(last), keyOf(last)) }
}

const assertId = (value: string): string => {
  if (!ID_RE.test(value)) throw new LearningError(400, 'BAD_REQUEST', '标识符格式无效')
  return value
}

const attemptSignature = (attempt: {
  readonly id: string
  readonly questionId: string
  readonly questionTitle: string
  readonly selfCheckId: string
  readonly prompt: string
  readonly answerId: string
  readonly answerLabel: string
  readonly correct: boolean
  readonly mistakeType?: 'concept' | 'direction' | 'modeling' | undefined
  readonly knowledge: readonly string[]
  readonly experimentId?: string | undefined
  readonly at: string
}): string =>
  JSON.stringify({
    id: attempt.id,
    questionId: attempt.questionId,
    questionTitle: attempt.questionTitle,
    selfCheckId: attempt.selfCheckId,
    prompt: attempt.prompt,
    answerId: attempt.answerId,
    answerLabel: attempt.answerLabel,
    correct: attempt.correct,
    mistakeType: attempt.mistakeType,
    knowledge: attempt.knowledge,
    experimentId: attempt.experimentId,
    at: attempt.at,
  })

const sceneSignature = (scene: {
  readonly sceneId: string
  readonly title: string
  readonly domain: string
  readonly kind: 'experiment' | 'question'
  readonly updatedAt: string
  readonly scene: Readonly<Record<string, unknown>>
}): string =>
  JSON.stringify({
    sceneId: scene.sceneId,
    title: scene.title,
    domain: scene.domain,
    kind: scene.kind,
    updatedAt: scene.updatedAt,
    scene: scene.scene,
  })

export class LearningService {
  constructor(private readonly domain: LearningDomain) {}

  private get attempts() {
    return this.domain.table('attempts')
  }
  private get scenes() {
    return this.domain.table('saved_scenes')
  }

  private ownsAttempt(actor: IdentityActor, row: PersonalAttemptRecord): boolean {
    return row.userKey === actor.userKey && row.schoolId === actor.schoolId
  }

  private ownsScene(actor: IdentityActor, row: SavedSceneRecord): boolean {
    return row.userKey === actor.userKey && row.schoolId === actor.schoolId
  }

  async saveAttempt(
    actor: IdentityActor,
    pathId: string,
    body: unknown,
  ): Promise<PersonalAttemptRecord> {
    const id = assertId(pathId)
    const parsed = attemptWire.safeParse(body)
    if (!parsed.success || parsed.data.id !== id) {
      throw new LearningError(400, 'BAD_REQUEST', '自测记录格式无效')
    }
    const key = attemptKey(actor.userKey, id)
    const existing = this.attempts.get(key)
    if (existing !== undefined) {
      if (!this.ownsAttempt(actor, existing)) {
        throw new LearningError(404, 'NOT_FOUND', '记录不存在')
      }
      if (attemptSignature(existing) !== attemptSignature(parsed.data)) {
        throw new LearningError(409, 'ID_CONFLICT', '同一自测记录 id 不能改写')
      }
      return existing
    }
    const record: PersonalAttemptRecord = {
      ...parsed.data,
      userKey: actor.userKey,
      schoolId: actor.schoolId,
      updatedAt: new Date().toISOString(),
    }
    await this.attempts.put(key, record)
    return record
  }

  listAttempts(actor: IdentityActor, query: ListQuery = {}): Page<PersonalAttemptRecord> {
    const rows = [...this.attempts.entries()]
      .map(([, row]) => row)
      .filter(row => this.ownsAttempt(actor, row))
    return pageOf(
      rows,
      query,
      row => row.at,
      row => row.id,
    )
  }

  async saveScene(actor: IdentityActor, pathId: string, body: unknown): Promise<SavedSceneRecord> {
    const id = assertId(pathId)
    const parsed = sceneEntryWire.safeParse(body)
    if (!parsed.success || parsed.data.sceneId !== id) {
      throw new LearningError(400, 'BAD_REQUEST', '实验场景格式无效')
    }
    if (Buffer.byteLength(JSON.stringify(parsed.data.scene), 'utf8') > MAX_SCENE_BYTES) {
      throw new LearningError(413, 'PAYLOAD_TOO_LARGE', '实验场景过大')
    }
    const key = savedSceneKey(actor.userKey, id)
    const existing = this.scenes.get(key)
    if (existing !== undefined) {
      if (!this.ownsScene(actor, existing)) {
        throw new LearningError(404, 'NOT_FOUND', '场景不存在')
      }
      if (sceneSignature(existing) === sceneSignature(parsed.data)) return existing
    }
    const record: SavedSceneRecord = {
      ...parsed.data,
      userKey: actor.userKey,
      schoolId: actor.schoolId,
      savedAt: new Date().toISOString(),
    }
    await this.scenes.put(key, record)
    return record
  }

  listScenes(actor: IdentityActor, query: ListQuery = {}): Page<SavedSceneRecord> {
    const rows = [...this.scenes.entries()]
      .map(([, row]) => row)
      .filter(row => this.ownsScene(actor, row))
    return pageOf(
      rows,
      query,
      row => row.updatedAt,
      row => row.sceneId,
    )
  }

  async deleteScene(actor: IdentityActor, pathId: string): Promise<void> {
    const id = assertId(pathId)
    const key = savedSceneKey(actor.userKey, id)
    const existing = this.scenes.get(key)
    if (existing === undefined) return
    if (!this.ownsScene(actor, existing)) {
      throw new LearningError(404, 'NOT_FOUND', '场景不存在')
    }
    await this.scenes.delete(key)
  }
}
