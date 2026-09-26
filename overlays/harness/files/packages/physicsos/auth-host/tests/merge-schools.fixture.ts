import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import type { AuthDomain, School } from '../src/domain.ts'
import { openAuthDomain } from '../src/domain.ts'
import {
  classMergeDomain,
  learningMergeDomain,
  type ClassMergeDomain,
  type LearningMergeDomain,
} from '../src/merge-schools-domain.ts'

export const SOURCE_SCHOOL_ID = 'gz_source'
export const TARGET_SCHOOL_ID = 'gz_target'
export const OPERATOR_KEY = 'PHYSICSOS-OPEN:ops-admin'
export const FIXED_TIME = '2026-09-26T10:00:00.000Z'

export interface MergeStores {
  readonly auth: AuthDomain
  readonly classroom: ClassMergeDomain
  readonly learning: LearningMergeDomain
}

export interface OpenedMergeFixture {
  readonly root: string
  readonly storageRoot: string
  readonly context: Context
  readonly stores: MergeStores
  readonly close: () => Promise<void>
  readonly unitFile: (unit: 'physicsos_auth' | 'physicsos_class' | 'physicsos_learning') => string
  readonly readUnit: (unit: 'physicsos_auth' | 'physicsos_class' | 'physicsos_learning') => Promise<string>
}

const school = (id: string, name: string): School => ({
  id,
  name,
  status: 'active',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
})

export async function openMergeFixture(): Promise<OpenedMergeFixture> {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-school-merge-'))
  const storageRoot = join(root, 'storages')
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(
    { apply: storageJson.apply, Config: storageJson.Config, inject: storageJson.inject },
    { root: storageRoot },
  )
  await context.plugin(
    {
      apply: storageDomain.apply,
      Config: storageDomain.Config,
      inject: storageDomain.inject,
    },
    { backend: 'json' },
  )
  const auth = await openAuthDomain(context)
  const classroom = await context.storageDomain.open(classMergeDomain)
  const learning = await context.storageDomain.open(learningMergeDomain)
  const stores = { auth, classroom, learning }
  const unitFile = (unit: 'physicsos_auth' | 'physicsos_class' | 'physicsos_learning') =>
    join(storageRoot, `${unit}.json`)
  return {
    root,
    storageRoot,
    context,
    stores,
    unitFile,
    readUnit: unit => readFile(unitFile(unit), 'utf8'),
    close: async () => {
      await auth.close()
      await classroom.close()
      await learning.close()
      await context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

export async function seedMergeData(
  stores: MergeStores,
  options: { readonly targetUserCollision?: boolean } = {},
): Promise<void> {
  const { auth, classroom, learning } = stores
  await auth.table('schools').put(SOURCE_SCHOOL_ID, school(SOURCE_SCHOOL_ID, '贵州测试学校'))
  await auth.table('schools').put(TARGET_SCHOOL_ID, school(TARGET_SCHOOL_ID, '贵州测试学校注册简称'))
  await auth.table('users').put(`${SOURCE_SCHOOL_ID}:alice`, {
    id: 'user_alice',
    schoolId: SOURCE_SCHOOL_ID,
    username: 'alice',
    passwordHash: 'hash',
    displayName: 'Alice',
    role: 'STUDENT',
    status: 'active',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  })
  await auth.table('users').put(`${SOURCE_SCHOOL_ID}:teacher`, {
    id: 'user_teacher',
    schoolId: SOURCE_SCHOOL_ID,
    username: 'teacher',
    passwordHash: 'hash',
    displayName: 'Teacher',
    role: 'TEACHER',
    status: 'active',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  })
  if (options.targetUserCollision === true) {
    await auth.table('users').put(`${TARGET_SCHOOL_ID}:alice`, {
      id: 'user_target_alice',
      schoolId: TARGET_SCHOOL_ID,
      username: 'alice',
      passwordHash: 'hash',
      displayName: 'Target Alice',
      role: 'STUDENT',
      status: 'active',
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    })
  }
  await auth.table('sessions').put('session_hash', {
    id: 'session_hash',
    userId: 'user_alice',
    schoolId: SOURCE_SCHOOL_ID,
    username: 'alice',
    remember: false,
    createdAt: FIXED_TIME,
    expiresAt: '2026-09-27T10:00:00.000Z',
  })
  await auth.table('reset_requests').put('reset_1', {
    id: 'reset_1',
    schoolId: SOURCE_SCHOOL_ID,
    username: 'alice',
    at: FIXED_TIME,
    status: 'pending',
    delivery: 'queue',
  })
  await auth.table('password_reset_tokens').put('token_hash', {
    id: 'token_hash',
    tokenHash: 'token_hash',
    requestId: 'reset_1',
    userId: 'user_alice',
    userKey: `${SOURCE_SCHOOL_ID}:alice`,
    schoolId: SOURCE_SCHOOL_ID,
    username: 'alice',
    createdAt: FIXED_TIME,
    expiresAt: '2026-09-26T10:30:00.000Z',
  })
  await auth.table('learning_counts').put(`${SOURCE_SCHOOL_ID}|2026-09-26|forces`, {
    id: `${SOURCE_SCHOOL_ID}|2026-09-26|forces`,
    schoolId: SOURCE_SCHOOL_ID,
    date: '2026-09-26',
    knowledgeId: 'forces',
    correct: 3,
    wrong: 1,
    updatedAt: FIXED_TIME,
  })
  await auth.table('devices').put(`${SOURCE_SCHOOL_ID}:alice|0123456789abcdef`, {
    id: `${SOURCE_SCHOOL_ID}:alice|0123456789abcdef`,
    deviceId: '0123456789abcdef',
    primaryUserKey: `${SOURCE_SCHOOL_ID}:alice`,
    schoolId: SOURCE_SCHOOL_ID,
    username: 'alice',
    firstSeenAt: FIXED_TIME,
    lastSeenAt: FIXED_TIME,
    seenCount: 1,
  })
  await auth.table('device_revocations').put(`${SOURCE_SCHOOL_ID}|0123456789abcdef`, {
    id: `${SOURCE_SCHOOL_ID}|0123456789abcdef`,
    scope: SOURCE_SCHOOL_ID,
    deviceId: '0123456789abcdef',
    revokedBy: `${SOURCE_SCHOOL_ID}:teacher`,
    revokedAt: FIXED_TIME,
    affectedSchools: [SOURCE_SCHOOL_ID],
  })
  await auth.table('api_resources').put('session:session-1', {
    id: 'session:session-1',
    kind: 'session',
    resourceId: 'session-1',
    ownerKey: `${SOURCE_SCHOOL_ID}:alice`,
    schoolId: SOURCE_SCHOOL_ID,
    createdAt: FIXED_TIME,
  })

  await classroom.table('classes').put('class-1', {
    id: 'class-1',
    schoolId: SOURCE_SCHOOL_ID,
    name: '高一（1）班',
    ownerKey: `${SOURCE_SCHOOL_ID}:teacher`,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  })
  await classroom.table('memberships').put(`class-1|${SOURCE_SCHOOL_ID}:alice`, {
    id: `class-1|${SOURCE_SCHOOL_ID}:alice`,
    classId: 'class-1',
    schoolId: SOURCE_SCHOOL_ID,
    userKey: `${SOURCE_SCHOOL_ID}:alice`,
    addedBy: `${SOURCE_SCHOOL_ID}:teacher`,
    addedAt: FIXED_TIME,
  })
  await classroom.table('assignments').put('assignment-1', {
    id: 'assignment-1',
    classId: 'class-1',
    schoolId: SOURCE_SCHOOL_ID,
    title: '力学作业',
    target: { kind: 'experiment', id: 'mechanics' },
    dueAt: '2026-09-27T10:00:00.000Z',
    createdBy: `${SOURCE_SCHOOL_ID}:teacher`,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  })
  await classroom.table('submissions').put(
    `class-1|assignment-1|${SOURCE_SCHOOL_ID}:alice`,
    {
      id: `class-1|assignment-1|${SOURCE_SCHOOL_ID}:alice`,
      classId: 'class-1',
      assignmentId: 'assignment-1',
      schoolId: SOURCE_SCHOOL_ID,
      studentKey: `${SOURCE_SCHOOL_ID}:alice`,
      content: '答案',
      submittedAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      review: {
        status: 'accepted',
        reviewedBy: `${SOURCE_SCHOOL_ID}:teacher`,
        reviewedAt: FIXED_TIME,
        score: 100,
      },
    },
  )

  await learning.table('attempts').put(`${SOURCE_SCHOOL_ID}:alice|attempt-1`, {
    id: 'attempt-1',
    questionId: 'question-1',
    questionTitle: '受力分析',
    selfCheckId: 'check-1',
    prompt: '选择正确答案',
    answerId: 'a',
    answerLabel: 'A',
    correct: true,
    knowledge: ['forces'],
    at: FIXED_TIME,
    userKey: `${SOURCE_SCHOOL_ID}:alice`,
    schoolId: SOURCE_SCHOOL_ID,
    updatedAt: FIXED_TIME,
  })
  await learning.table('saved_scenes').put(`${SOURCE_SCHOOL_ID}:alice|scene-1`, {
    sceneId: 'scene-1',
    title: '斜面实验',
    domain: 'mechanics',
    kind: 'experiment',
    updatedAt: FIXED_TIME,
    scene: {
      schemaVersion: 'physics-scene/1.0',
      id: 'scene-1',
      revision: 1,
      dimension: '2d',
    },
    userKey: `${SOURCE_SCHOOL_ID}:alice`,
    schoolId: SOURCE_SCHOOL_ID,
    savedAt: FIXED_TIME,
  })
}
