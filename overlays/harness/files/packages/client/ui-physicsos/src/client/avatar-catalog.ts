/**
 * The public avatar catalog, mirrored by auth-host/src/avatar-catalog.ts.
 * Artwork is served separately: never inline the twelve images into the shell.
 * Clothing is a contemporary Guizhou-inspired design, not a ceremonial replica.
 */
export const AVATAR_EDITION = 'guizhou-v1'
export const AVATAR_IDS = Object.freeze([
  'silver-greeting', 'indigo-reader', 'butterfly-light', 'pendulum',
  'batik-star', 'mountain-sound', 'lens-maker', 'copper-drum',
  'green-wave', 'red-embroidery', 'silver-moon', 'discovery',
] as const)
export type AvatarId = typeof AVATAR_IDS[number]

export const avatarUrlForId = (id: AvatarId): string =>
  `/physicsos/avatars/${AVATAR_EDITION}/${id}-192.webp`

export const AVATAR_CATALOG = Object.freeze([
  { id: 'silver-greeting', name: '银饰迎新', description: '靛蓝衣装与银色饰物，向新一天问好。' },
  { id: 'indigo-reader', name: '靛蓝读书', description: '翻开书本，让好奇心继续生长。' },
  { id: 'butterfly-light', name: '蝶光绣纹', description: '循着蝴蝶的轻盈，观察光与色彩。' },
  { id: 'pendulum', name: '摆球探索', description: '从一次摆动开始，发现运动的规律。' },
  { id: 'batik-star', name: '蜡染星图', description: '蓝白纹样与星光相遇，装下一个小宇宙。' },
  { id: 'mountain-sound', name: '山水听音', description: '倾听山间回响，探索声音的秘密。' },
  { id: 'lens-maker', name: '透镜小匠', description: '透过镜片，换一个角度看世界。' },
  { id: 'copper-drum', name: '铜鼓节律', description: '跟随鼓声的节奏，感受振动与共鸣。' },
  { id: 'green-wave', name: '青绿涟漪', description: '一圈圈涟漪，把问题带向远方。' },
  { id: 'red-embroidery', name: '绛红绣纹', description: '原创绣纹与暖红衣装，点亮学习时刻。' },
  { id: 'silver-moon', name: '银月静思', description: '银色月光相伴，静静整理今天的发现。' },
  { id: 'discovery', name: '灵感发现', description: '带着新的问题，出发寻找下一次发现。' },
] as const satisfies readonly { readonly id: AvatarId; readonly name: string; readonly description: string }[])

const ids = new Set<string>(AVATAR_IDS)
const idsByUrl = new Map(AVATAR_IDS.map(id => [avatarUrlForId(id), id]))
export const isAvatarId = (value: unknown): value is AvatarId =>
  typeof value === 'string' && ids.has(value)
export const avatarIdFromUrl = (url: unknown): AvatarId | undefined =>
  typeof url === 'string' ? idsByUrl.get(url) : undefined

/** Guards both account replacement and same-username accounts in different tenants. */
export interface AvatarOwner {
  readonly id: string
  readonly schoolId: string
  readonly username: string
}
export const AVATAR_OWNER_HEADER = 'x-physicsos-expected-owner'
export const sameAvatarOwner = (left: AvatarOwner | undefined, right: AvatarOwner | undefined): boolean =>
  left !== undefined && right !== undefined && left.id === right.id
    && left.schoolId === right.schoolId && left.username === right.username
