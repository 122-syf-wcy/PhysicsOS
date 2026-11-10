export const PROTOCOL_VERSION = 1 as const
export const ASSET_ORIGIN = 'https://appassets.androidplatform.net'
export const ASSET_PREFIX = '/assets/lab/'
export const MAX_ENVELOPE_BYTES = 12 * 1024 * 1024
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_DEPTH = 64
export const STATE_INTERVAL_MS = 250
export const EXPORT_MIME = {
  json: 'application/json', csv: 'text/csv', markdown: 'text/markdown',
  svg: 'image/svg+xml', png: 'image/png',
} as const
export type ExportFormat = keyof typeof EXPORT_MIME
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface Envelope<T extends string = string, P = Record<string, unknown>> {
  version: typeof PROTOCOL_VERSION
  id: string
  type: T
  payload: P
}
export interface DocumentBlock { id: string; markdown?: string; text?: string }
export interface DocumentPayload {
  generation: string
  title?: string
  markdown?: string
  text?: string
  blocks?: DocumentBlock[]
  fontScale?: number
}
export type NativeCommand =
  | Envelope<'load', { generation: string; templateId?: string; scene?: unknown; originScene?: unknown; checkpoint?: unknown }>
  | Envelope<'document', DocumentPayload>
  | Envelope<'lifecycle', { generation: string; active: boolean }>
  | Envelope<'theme', { generation: string; dark: boolean }>
  | Envelope<'checkpoint', { generation: string }>
  | Envelope<'export', { generation: string; format: ExportFormat }>
export interface ExportFile {
  name: string
  mime: (typeof EXPORT_MIME)[ExportFormat]
  encoding: 'utf8' | 'base64'
  content: string
}

export class LabError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'LabError' }
}
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
export const fail = (code: string, message: string): never => { throw new LabError(code, message) }
export const text = (value: unknown, max = 128, empty = false): value is string =>
  typeof value === 'string' && (empty || value.length > 0) && value.length <= max && !value.includes('\u0000')
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export const isGeneration = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_MESSAGE', '消息含未支持的字段。')
}

/** Limits are checked before walking/encoding. Functions, accessors and prototype keys are not data. */
export function assertJson(value: unknown, maxBytes = MAX_FILE_BYTES): asserts value is Json {
  let nodes = 0
  const parents = new Set<object>()
  const walk = (item: unknown, depth: number): void => {
    if (++nodes > 600_000 || depth > MAX_DEPTH) fail('DATA_LIMIT', '数据层级或条目数超过本地文档限制。')
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('INVALID_DATA', '数据包含非有限数值。'); return }
    if (typeof item !== 'object') fail('INVALID_DATA', '只接受可序列化的数据。')
    if (parents.has(item)) fail('INVALID_DATA', '数据不能有循环引用。')
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      fail('INVALID_DATA', '数据不能携带行为或自定义原型。')
    }
    parents.add(item)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (key === 'length' && Array.isArray(item)) continue
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || descriptor.get || descriptor.set) {
        fail('INVALID_DATA', '数据含不允许的对象字段。')
      }
      walk(descriptor.value, depth + 1)
    }
    parents.delete(item)
  }
  walk(value, 0)
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) fail('DATA_LIMIT', '完整数据超过允许体积；未截断或丢弃历史。')
}
export function stringifyBounded(value: unknown, maxBytes = MAX_FILE_BYTES): string {
  assertJson(value, maxBytes)
  return JSON.stringify(value)
}
export function parseNativeCommand(input: unknown): NativeCommand {
  if (typeof input !== 'string' || input.length > MAX_ENVELOPE_BYTES
    || new TextEncoder().encode(input).byteLength > MAX_ENVELOPE_BYTES) fail('MESSAGE_LIMIT', '消息超过允许体积。')
  let data: unknown
  try { data = JSON.parse(input) } catch { fail('INVALID_MESSAGE', '消息不是有效的 JSON。') }
  assertJson(data, MAX_ENVELOPE_BYTES)
  if (!object(data)) fail('INVALID_MESSAGE', '消息必须为对象。')
  exactKeys(data, ['version', 'id', 'type', 'payload'])
  if (data.version !== PROTOCOL_VERSION || !text(data.id) || !object(data.payload)) fail('PROTOCOL_VERSION', '消息协议或标识不匹配。')
  const payload = data.payload
  if (!isGeneration(payload.generation)) fail('INVALID_GENERATION', '渲染代际标识无效。')
  switch (data.type) {
    case 'load':
      exactKeys(payload, ['generation', 'templateId', 'scene', 'originScene', 'checkpoint'])
      if (payload.templateId !== undefined && !text(payload.templateId)) fail('INVALID_TEMPLATE', '实验目录标识无效。')
      if (payload.scene === undefined && payload.templateId === undefined && payload.checkpoint === undefined) fail('LOAD_REQUIRED', '请选择实验或提供完整场景。')
      if (payload.scene !== undefined) assertJson(payload.scene)
      if (payload.originScene !== undefined) {
        if (payload.scene === undefined && payload.checkpoint === undefined) fail('LOAD_REQUIRED', '来源场景需要与当前场景一起加载。')
        assertJson(payload.originScene)
      }
      if (payload.checkpoint !== undefined) assertJson(payload.checkpoint)
      break
    case 'document': {
      exactKeys(payload, ['generation', 'title', 'markdown', 'text', 'blocks', 'fontScale'])
      if (payload.title !== undefined && !text(payload.title, 300, true)) fail('INVALID_DOCUMENT', '文档标题过长。')
      if (payload.fontScale !== undefined && (!finite(payload.fontScale) || payload.fontScale < 0.5 || payload.fontScale > 5)) fail('INVALID_DOCUMENT', '字号倍率必须在 0.5 至 5 之间。')
      if (payload.blocks !== undefined) {
        if (!Array.isArray(payload.blocks) || payload.blocks.length > 2048) fail('INVALID_DOCUMENT', '文档分块超过限制。')
        const ids = new Set<string>()
        for (const block of payload.blocks) {
          if (!object(block)) fail('INVALID_DOCUMENT', '文档分块无效。')
          exactKeys(block, ['id', 'markdown', 'text'])
          if (!text(block.id) || ids.has(block.id)) fail('INVALID_DOCUMENT', '文档分块标识必须唯一。')
          ids.add(block.id)
          validateTextContent(block)
        }
        if (payload.markdown !== undefined || payload.text !== undefined) fail('INVALID_DOCUMENT', '分块与整篇内容不能同时传入。')
      } else validateTextContent(payload)
      break
    }
    case 'lifecycle':
      exactKeys(payload, ['generation', 'active'])
      if (typeof payload.active !== 'boolean') fail('INVALID_MESSAGE', '生命周期状态无效。')
      break
    case 'theme':
      exactKeys(payload, ['generation', 'dark'])
      if (typeof payload.dark !== 'boolean') fail('INVALID_MESSAGE', '主题状态无效。')
      break
    case 'checkpoint': exactKeys(payload, ['generation']); break
    case 'export':
      exactKeys(payload, ['generation', 'format'])
      if (typeof payload.format !== 'string' || !Object.hasOwn(EXPORT_MIME, payload.format)) fail('EXPORT_FORMAT', '不支持该导出格式。')
      break
    default: fail('UNKNOWN_MESSAGE', '未支持的消息类型。')
  }
  return data as unknown as NativeCommand
}
function validateTextContent(value: Record<string, unknown>): void {
  const hasMarkdown = typeof value.markdown === 'string'
  const hasText = typeof value.text === 'string'
  if (hasMarkdown === hasText || (value.markdown !== undefined && !hasMarkdown) || (value.text !== undefined && !hasText)) {
    fail('INVALID_DOCUMENT', '文档只能包含 Markdown 或纯文本内容。')
  }
  if (!text(hasMarkdown ? value.markdown : value.text, MAX_FILE_BYTES, true)) fail('INVALID_DOCUMENT', '文档内容超过限制。')
}
export function validateExport(file: ExportFile): void {
  if (!text(file.name, 180) || /[\\/\x00-\x1f]/.test(file.name) || file.name === '.' || file.name === '..') fail('EXPORT_NAME', '导出文件名无效。')
  if (!Object.values(EXPORT_MIME).includes(file.mime)) fail('EXPORT_MIME', '导出格式不受支持。')
  if (file.encoding === 'utf8') {
    if (new TextEncoder().encode(file.content).byteLength > MAX_FILE_BYTES) fail('EXPORT_LIMIT', '完整导出超过 8 MiB，未生成不完整文件。')
  } else if (file.encoding === 'base64') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)
      || file.content.length * 3 / 4 - (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0) > MAX_FILE_BYTES) {
      fail('EXPORT_LIMIT', '导出编码无效或超过 8 MiB。')
    }
  } else fail('EXPORT_ENCODING', '导出编码不受支持。')
}
export function errorPayload(error: unknown): { code: string; message: string } {
  return { code: error instanceof LabError ? error.code.slice(0, 80) : 'LAB_ERROR',
    message: (error instanceof Error ? error.message : '实验操作失败，请重试。').slice(0, 2000) }
}
export function safeFileName(title: string, extension: string): string {
  return `${title.replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').trim().slice(0, 120) || 'PhysicsOS'}.${extension}`
}
