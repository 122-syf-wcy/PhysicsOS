/** Portable prompt document format, shared by server, admin and developer docs. */
export interface TemplateRelease {
  schemaVersion: 2
  experimentId: 'convex-lens'
  url: string
  sha256: string
  bytes: number
}
export interface PromptBinding {
  release: TemplateRelease
  contractMarkdown: string
}
export interface PromptSeed {
  body: string
  binding: PromptBinding
}
export interface PromptDocument extends PromptSeed {
  id: string
  version: string
  sha256: string
  publishedAt: string | null
}
export const PROMPT_BODY_LIMIT = 64 * 1024
export const PROMPT_IMPORT_LIMIT = 128 * 1024
export const PROMPT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const start = '<!-- physicsos:editable:start -->'
const end = '<!-- physicsos:editable:end -->'
const fixedStart = '<!-- physicsos:contract:start -->'
const fixedEnd = '<!-- physicsos:contract:end -->'
const reserved = /<!--\s*physicsos:/i
const utf8 = new TextEncoder()
const utf8Text = new TextDecoder('utf-8', { fatal: true })

/** Validate the entire input before extracting fields; whitespace may be Markdown syntax. */
function normalizeText(text: string): string {
  const value = text.replace(/^\uFEFF+/, '').replace(/\r\n?/g, '\n')
  if (
    utf8Text.decode(utf8.encode(value)) !== value ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new Error('Markdown 不能包含无效 Unicode 或禁止的控制字符。')
  return value
}

/** Preserve author indentation/line breaks; normalize only BOM and line-ending encoding. */
export function validateBody(text: string): string {
  const body = normalizeText(text)
  if (!body.trim() || utf8.encode(body).length > PROMPT_BODY_LIMIT || reserved.test(body))
    throw new Error('正文须为 1–64 KiB 的有效 Markdown 文本，不能包含控制字符或平台保留标记。')
  return body
}

/** Accept either a plain body or a complete, unambiguous platform export. */
export function importPromptMarkdown(text: string): string {
  const normalized = normalizeText(text)
  if (!reserved.test(normalized)) return validateBody(normalized)
  const markers = [start, end, fixedStart, fixedEnd]
  const positions = markers.map(marker => normalized.indexOf(marker))
  if (
    markers.some(
      (marker, index) =>
        positions[index] === -1 ||
        normalized.indexOf(marker, (positions[index] ?? -1) + marker.length) !== -1,
    ) ||
    positions.some((position, index) => index > 0 && position <= (positions[index - 1] ?? -1))
  )
    throw new Error(
      '完整提示词的可编辑区域标记残缺或重复，请上传完整导出文件或仅包含正文的 Markdown。',
    )
  const withoutMarkers = markers.reduce((value, marker) => value.replace(marker, ''), normalized)
  if (reserved.test(withoutMarkers)) throw new Error('Markdown 含未知平台标记。')
  const framed = normalized.slice((positions[0] ?? 0) + start.length, positions[1])
  // renderPrompt contributes one newline on either side. Preserve author-owned whitespace.
  return validateBody(framed.replace(/^\n/, '').replace(/\n$/, ''))
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function validPromptBinding(value: unknown): value is PromptBinding {
  if (!object(value) || !object(value.release)) return false
  const release = value.release
  return (
    release.schemaVersion === 2 &&
    release.experimentId === 'convex-lens' &&
    typeof release.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(release.sha256) &&
    release.url ===
      `/physicsos/developers/downloads/physicsos-experiment-template-v2-${release.sha256}.zip` &&
    typeof release.bytes === 'number' &&
    Number.isSafeInteger(release.bytes) &&
    release.bytes > 0 &&
    typeof value.contractMarkdown === 'string' &&
    value.contractMarkdown.trim().length > 0 &&
    utf8.encode(value.contractMarkdown).length <= PROMPT_BODY_LIMIT &&
    !reserved.test(value.contractMarkdown)
  )
}
/** Validate public API data before enabling bound copy/download actions. */
export function validPromptDocument(value: unknown): value is PromptDocument {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !/^(system-default|prompt_[a-f0-9]{32})$/.test(value.id) ||
    typeof value.version !== 'string' ||
    value.version.length > 32 ||
    !PROMPT_VERSION.test(value.version) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !validPromptBinding(value.binding) ||
    typeof value.body !== 'string' ||
    !(value.publishedAt === null
      ? value.id === 'system-default'
      : typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt)))
  )
    return false
  try {
    return validateBody(value.body) === value.body
  } catch {
    return false
  }
}

/** The full export is generated from one body and its frozen platform binding. */
export function renderPrompt(
  document: Pick<PromptDocument, 'version' | 'body' | 'binding'>,
  origin: string,
  task = '',
): string {
  if (
    !validPromptBinding(document.binding) ||
    !PROMPT_VERSION.test(document.version) ||
    document.version.length > 32
  )
    throw new Error('提示词版本或模板绑定无效。')
  const source = new URL(origin)
  if (!['https:', 'http:'].includes(source.protocol) || source.origin !== origin)
    throw new Error('提示词来源无效。')
  const body = validateBody(document.body)
  const release = document.binding.release
  return `# PhysicsOS 实验开发提示词

提示词版本：${document.version}
目标实验：convex-lens。将完整文件保存为独立模板目录的 AGENTS.md。
以下可编辑说明优先于模板中的初始开发说明；系统固定契约始终适用。

${start}
${body}
${end}

${fixedStart}
${document.binding.contractMarkdown.trim()}

## 可信模板发布身份

模板 URL：${new URL(release.url, origin).href}
SHA-256：${release.sha256}
字节数：${release.bytes}
核对实际下载字节后开发，执行 npm run release，提交生成的 ZIP 与真实检查报告。
${fixedEnd}
${task.trim() ? `\n## 本次用户任务\n\n${task.trim()}\n` : ''}`
}
