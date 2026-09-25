/**
 * Storage-domain spec for the PhysicsOS 账户体系 — one `physicsos_auth` unit
 * over the JSON backend with a table per identity fact: schools (tenants),
 * users (keyed `schoolId:username`, which makes UNIQUE(school_id, username)
 * structural rather than enforced), sessions (keyed by the SHA-256 of the
 * opaque cookie token, so tokens never rest in the store), password-reset
 * requests, school applications, and the append-only admin audit ledger.
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

const role = z.enum(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'])

const school = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().optional(),
  logoUrl: z.string().optional(),
  /** 地州市 label (e.g. 黔东南州) — carried by roster seeds for disambiguation. */
  city: z.string().optional(),
  /** 区县 label when the roster source carries one. */
  county: z.string().optional(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const user = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().optional(),
  role,
  status: z.enum(['active', 'disabled']),
  lastLoginAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const session = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  schoolId: z.string().min(1),
  /** Lower-cased login username — with schoolId it rebuilds the user-key, so
      session resolution stays O(1) instead of scanning the users table. */
  username: z.string().min(1),
  remember: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  /** 这次会话是从哪台登记过的设备发起的;只有客户端报了 deviceId 时才有值。 */
  deviceId: z.string().optional(),
})

const resetRequest = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  username: z.string().min(1),
  at: z.string(),
  ip: z.string().optional(),
})

/* A school's application to join PhysicsOS — the register view's 申请开通
   submission lands here for a SUPER_ADMIN to approve or reject. */
const schoolRequest = z.object({
  id: z.string().min(1),
  schoolName: z.string().min(1),
  contact: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected']),
  /** userKey of the submitter; anonymous submissions carry null. */
  requestedBy: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
})

/* Append-only admin action ledger — every state-changing admin verb writes
   one row; there is no update path by design. */
const auditEvent = z.object({
  id: z.string().min(1),
  /** userKey (`schoolId:username`) of the acting admin. */
  actorKey: z.string().min(1),
  /** Tenant the action touched — school-scoped audit reads filter on this. */
  schoolId: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})

/* 学习上报的聚合计数 —— 一行就是一个小格子:(学校, 日期, 知识点) → 对/错次数。

   有意为之的四列,别的一律没有:没有 userId、没有账号、没有答题原文、没有自
   由文本。一行回答的是「某校某天某知识点答对/答错多少次」,不是「谁答了
   什么」。日期由服务端时钟决定而不是客户端传,所以改本机时间改不动台账。 */
const learningCount = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  /** 宿主本地日期 `YYYY-MM-DD`,由服务端时钟写入,不来自请求体。 */
  date: z.string().min(1),
  knowledgeId: z.string().min(1),
  correct: z.number().int().min(0),
  wrong: z.number().int().min(0),
  updatedAt: z.string(),
})

/* 设备登记 —— 「设备身份 / 远程注销 / 异常风控」的那张表,不是一机一码锁死。

   一机一码锁死按用户决定**不做**:这个软件免费给学校,卡住的只会是自己人。所以
   这张表回答的是「这台机器是不是这个账号认过的」,而不是「这台机器有没有资格
   开机」。

   `deviceId` 必须是**哈希**(去掉连字符的小写十六进制)。`registerDeviceWire`
   的正则把原始序列号挡在门外 —— 换机政策里写明「只上传哈希,不上传原始
   IOPlatformUUID / MachineGuid」,如果这一列能塞进带连字符的原始串,那条承诺
   就只是一句注释。 */

const DEVICE_ID_RE = /^[a-f0-9]{16,128}$/

/** 形状闸门本身也是 wire —— 登录 / 注册 / 登记三处共用同一个,不各写一份。 */
export const deviceIdWire = z.string().regex(DEVICE_ID_RE)

const device = z.object({
  id: z.string().min(1),
  /** 客户端算好的哈希;本服务只存它,永远不存原始硬件串。 */
  deviceId: z.string().min(1),
  /** `userKey`(`schoolId:username`)——设备绑在**账号**上,不是绑在学校上。 */
  primaryUserKey: z.string().min(1),
  schoolId: z.string().min(1),
  username: z.string().min(1),
  platform: z.enum(['macos', 'windows', 'linux', 'web', 'other']).optional(),
  appVersion: z.string().optional(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  seenCount: z.number().int().min(1),
})

/* 设备注销 —— 与上面的「这台账号见过这台机器」是**两件事**,所以是两张表。

   放在同一张表里会出错,而且这个错很隐蔽:注销若记在 `(账号, 设备)` 行上,同一
   台机器换一个账号登录就是一行新的干净记录,注销被绕过。用户要的是「远程注销这
   台设备」,那就必须按**物理机器**记账。

   `scope` 是租户边界:`'*'` 表示平台管理员做的全局注销(对所有学校生效),
   否则是某校管理员对自己学校设备的注销 —— 一所学校不该能把另一所学校在共用机
   房里的机器锁掉。 */

const GLOBAL_SCOPE = '*'

const deviceRevocation = z.object({
  id: z.string().min(1),
  /** `'*'` 或 `schoolId`。 */
  scope: z.string().min(1),
  deviceId: z.string().min(1),
  /** 发起注销的管理员 `userKey`,便于追溯。 */
  revokedBy: z.string().min(1),
  revokedAt: z.string(),
  /**
   * 这把锁实际影响了哪些学校。
   *
   * 台账要按租户各写一行(GZU 有权在自己的审计里看到「我们学校有台设备被平台
   * 注销了」),而恢复时那台设备可能已经没有设备行了 —— 所以受影响租户在**注销
   * 那一刻**就记下来,不靠事后从别处推。
   */
  affectedSchools: z.array(z.string()),
})

export type School = z.infer<typeof school>
export type UserRecord = z.infer<typeof user>
export type SessionRecord = z.infer<typeof session>
export type ResetRequest = z.infer<typeof resetRequest>
export type SchoolRequestRecord = z.infer<typeof schoolRequest>
export type AuditEvent = z.infer<typeof auditEvent>
export type LearningCount = z.infer<typeof learningCount>
export type DeviceRecord = z.infer<typeof device>
export type DeviceRevocation = z.infer<typeof deviceRevocation>

/**
 * Registration accepts exactly these fields; `role` is never client input.
 * The school arrives as free-text `schoolName` resolved host-side (unique
 * active match wins, ambiguity returns candidates); `schoolId` is the
 * disambiguation answer — never a form the user picks from a public list.
 */
export const registerWire = z.object({
  schoolId: z.string().min(1).optional(),
  schoolName: z.string().min(1).max(64).optional(),
  username: z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/),
  displayName: z.string().min(1).max(32),
  password: z.string().min(8).max(128),
  /** 首启登记的那台设备(哈希形状同上),注册即绑定。 */
  deviceId: deviceIdWire.optional(),
}).refine(data => data.schoolId !== undefined || data.schoolName !== undefined, {
  message: 'schoolName or schoolId required',
})

/**
 * Login is account + password; the host resolves the tenant globally.
 * `schoolId` exists only to disambiguate the rare same-username-same-password
 * collision the host reports back with candidates.
 */
export const loginWire = z.object({
  schoolId: z.string().min(1).optional(),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  rememberDevice: z.boolean().optional(),
  /** 登录时带上设备哈希,会话行就记住了这台机器 —— 远程注销据此定点失效。 */
  deviceId: deviceIdWire.optional(),
})

export const forgotWire = z.object({
  schoolId: z.string().min(1).optional(),
  username: z.string().min(1).max(64),
})

/** 申请开通 a school — anonymous-allowed, IP rate-limited upstream. */
export const schoolRequestWire = z.object({
  schoolName: z.string().min(2).max(64),
  contact: z.string().min(2).max(128),
})

const schoolIdWire = z.string().regex(/^[A-Za-z0-9_-]{2,32}$/)

/** SUPER_ADMIN approves an application and seeds its first school admin. */
export const approveRequestWire = z.object({
  schoolId: schoolIdWire,
  shortName: z.string().min(1).max(16).optional(),
  adminUsername: registerWire.shape.username,
  adminDisplayName: registerWire.shape.displayName,
  adminPassword: registerWire.shape.password,
})

export const rejectRequestWire = z.object({
  reason: z.string().max(200).optional(),
})

export const createSchoolWire = z.object({
  id: schoolIdWire,
  name: z.string().min(2).max(64),
  shortName: z.string().min(1).max(16).optional(),
})

export const schoolStatusWire = z.object({
  status: z.enum(['active', 'disabled']),
})

/** Admin user provisioning — `SUPER_ADMIN` is structurally unreachable here:
    the enum omits it, so no wire value can mint one. `schoolId` is required
    for SUPER_ADMIN; a SCHOOL_ADMIN may omit it (own tenant implied) but a
    mismatched value is refused. */
export const createUserWire = z.object({
  schoolId: z.string().min(1).max(64).optional(),
  username: registerWire.shape.username,
  displayName: registerWire.shape.displayName,
  password: registerWire.shape.password,
  role: z.enum(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN']),
})

export const userStatusWire = z.object({
  status: z.enum(['active', 'disabled']),
})

export const resetPasswordWire = z.object({
  newPassword: registerWire.shape.password,
})

/**
 * 学习上报的请求体 —— 只有两个字段,且都不是身份。
 *
 * `knowledgeId` 必须是课标知识点 id 的形状(小写字母/数字/连字符),所以客户端
 * 塞不进「学生写了什么」;`correct` 是这一次自测的对错。学校取会话、日期取服务
 * 端时钟,两者都不在请求体里。
 */
export const learningReportWire = z.object({
  knowledgeId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  correct: z.boolean(),
})

/**
 * 聚合计数的键 — `schoolId|date|knowledgeId`。
 *
 * `|` 是安全的分隔符而非随手选的:`schoolId` 的字母表是 `[A-Za-z0-9_-]`、
 * 日期是 `YYYY-MM-DD`、知识点 id 是 `[a-z0-9-]`,三段都不含 `|`,所以这个键
 * 不会被拼歧义。反过来,无论谁调 `reportLearning`,同一格永远落在同一行。
 */
export const learningKey = (schoolId: string, date: string, knowledgeId: string): string =>
  `${schoolId}|${date}|${knowledgeId}`

/**
 * 设备登记的请求体。
 *
 * 只有三样东西,而且都不是身份:设备哈希、平台、应用版本。账号取自会话、
 * 学校取自会话 —— 客户端说不上话。
 *
 * `deviceId` 的闸门是**哈希形状**而不是「非空字符串」:原始序列号里有连字符、
 * 常常带大写,塞不进来。这条正则就是「只上传哈希」那句承诺的可执行形式。
 */
export const registerDeviceWire = z.object({
  deviceId: deviceIdWire,
  platform: z.enum(['macos', 'windows', 'linux', 'web', 'other']).optional(),
  appVersion: z.string().max(32).optional(),
})

/**
 * 设备行的键 —— `userKey|deviceId`。
 *
 * `|` 是安全的分隔符:schoolId 的字母表是 `[A-Za-z0-9_-]`、username 是
 * `[a-z0-9_.-]`、deviceId 是 `[a-f0-9]`,三段都不含 `|`(而 `:` 在 username 里
 * 出现过,所以不能拿它当第二级分隔符)。一台共享电脑换一个账号登录就是一**新
 * 行**:设备跟着账号走,不会把两个学生合成一条。
 */
export const deviceKey = (userKeyValue: string, deviceId: string): string =>
  `${userKeyValue}|${deviceId}`

/** 设备注销行的键 —— `scope|deviceId`,scope 为 `'*'` 或学校 id。 */
export const deviceRevocationKey = (scope: string, deviceId: string): string =>
  `${scope}|${deviceId}`

/** 平台管理员的注销作用域。 */
export const GLOBAL_DEVICE_SCOPE = GLOBAL_SCOPE

/** The users-table key — the durable form of UNIQUE(school_id, username). */
export const userKey = (schoolId: string, username: string): string =>
  `${schoolId}:${username.toLowerCase()}`

/**
 * The auth durable unit. `users`/`sessions` keys are lookup paths (school +
 * username, token hash) — the row `id` stays the opaque cross-reference.
 */
export const authDomain = defineDomain({
  name: 'physicsos_auth',
  version: 0,
  tables: {
    schools: domainTable<string, School>(school),
    users: domainTable<string, UserRecord>(user),
    sessions: domainTable<string, SessionRecord>(session),
    reset_requests: domainTable<string, ResetRequest>(resetRequest),
    school_requests: domainTable<string, SchoolRequestRecord>(schoolRequest),
    admin_audit: domainTable<string, AuditEvent>(auditEvent),
    learning_counts: domainTable<string, LearningCount>(learningCount),
    devices: domainTable<string, DeviceRecord>(device),
    device_revocations: domainTable<string, DeviceRevocation>(deviceRevocation),
  },
})

/** Handle the opened domain hands to the route layer. */
export type AuthDomain = Domain<typeof authDomain>

import type { Context } from '@deepseek-ai/cordis'

/**
 * Open the auth domain on the mounted storage facility.
 * @param ctx - plugin context carrying the `storageDomain` service.
 * @returns the opened domain, typed by {@link authDomain}.
 */
export async function openAuthDomain(ctx: Context): Promise<AuthDomain> {
  return ctx.storageDomain.open(authDomain)
}
