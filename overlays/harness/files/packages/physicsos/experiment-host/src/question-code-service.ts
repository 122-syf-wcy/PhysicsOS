import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { link, mkdir, open, rename, rm, mkdtemp } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { pickEngine, domainOfEngine } from '@physicsos/physics-runtime'
import { canonicalJson, type CodeExperimentRef, type CodeVisualizationSource } from '@physicsos/agent-tools'
import { z } from 'zod'
import { init, parse } from 'es-module-lexer'
import { ExperimentError, type PhysicsosIdentity, type IdentityActor } from './identity.ts'
import { ASSET_PREFIX, type Asset } from './service.ts'
import { experimentProfile, manifestV3Schema, validatePackageMetadataV3 } from './contract-v3.ts'
import { experimentTemplateFiles } from './template-download.ts'
import { safeArchivePath, validatePackageResources, assetContentType } from './package-resources.ts'
import {
  questionCodeDomain,
  questionCodeRecordSchema,
  type QuestionCodeRecord,
} from './question-code-domain.ts'
import { questionCodeContext, styleVersionOf, type QuestionCodeContext } from './question-code-context.ts'
import type { DeveloperPromptService } from './prompt-service.ts'
import { QuestionCodeAssets, type QuestionAssetDescriptor } from './question-code-assets.ts'
import { CANVAS_TEXT_SHIM } from './question-code-canvas-text.ts'
export interface QuestionAssetRequest { ownerSessionId: string; generationId: string; scene: unknown; prompt: string; kind: 'environment' | 'material'; signal: AbortSignal }
export type QuestionAssetScope = Pick<QuestionAssetRequest, 'ownerSessionId' | 'generationId' | 'scene'>
export const QUESTION_CODE_SERVICE = 'questionCodeArtifacts'
export interface QuestionCodeIdentity extends PhysicsosIdentity {
  sessionOwnerKey(sessionId: string): string | undefined
}
export interface CreateQuestionCodeInput {
  ownerSessionId: string
  scene: PhysicsScene
  experimentId: string
  childSessionId: string
  source: CodeVisualizationSource
  generationId?: string
}
export interface QuestionCodeArtifacts {
  /** `signal` lets a caller that gave up stop the create before it commits. */
  create(input: CreateQuestionCodeInput, signal?: AbortSignal): Promise<CodeExperimentRef>
  context(experimentId: string): Promise<QuestionCodeContext>
  describe(ownerSessionId: string, artifactId: string, expectedSha256: string): CodeExperimentRef
  generateAsset(input: QuestionAssetRequest): Promise<QuestionAssetDescriptor>
  assetManifest(input: QuestionAssetScope): QuestionAssetDescriptor[]
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    questionCodeArtifacts: QuestionCodeArtifacts
  }
}
export interface QuestionCodeOptions {
  root: string
  identity: () => QuestionCodeIdentity | undefined
  prompts?: Pick<DeveloperPromptService, 'current'>
  assetOrigin?: string
  previewTtlMs?: number
  imageAssets?: QuestionCodeAssets
}
const executeFile = promisify(execFile)
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
/**
 * Stable across object key ordering, while preserving every question field
 * and array order. One definition, shared with the generation pipeline via
 * `@physicsos/agent-tools`, so host and generator digest the same bytes.
 */
export const canonicalQuestionJson: (value: unknown) => string = canonicalJson
export const questionSceneSha256 = (scene: PhysicsScene): string =>
  hash(canonicalQuestionJson(scene))
const sourceSchema = z
  .object({
    title: z.string().min(1).max(120).refine(value => value.trim().length > 0),
    summary: z.string().max(1000),
    rendererJs: z.string().min(1),
    stylesheet: z.string(),
  })
  .strict()
const inputSchema = z
  .object({
    ownerSessionId: z.string().min(1).max(200),
    childSessionId: z.string().min(1).max(200),
    experimentId: z.string().min(1).max(100),
    scene: z.unknown(),
    source: sourceSchema,
    generationId: z.string().min(1).max(200).optional(),
  })
  .strict()
const missing = (): ExperimentError =>
  new ExperimentError(404, 'NOT_FOUND', '未找到当前账号的题目实验。')
type SourceValidationReason =
  | 'missing_export'
  | 'module_dependency'
  | 'missing_native_entry'
  | 'legacy_renderer'
  | 'missing_engine_geometry'
  | 'missing_native_drawing'
  | 'invalid_visibility_key'
  | 'syntax_error'
class DrawingValidationError extends Error {
  constructor(readonly reason: SourceValidationReason) {
    super('Independent drawing validation failed')
  }
}
const invalidSource = (reason?: SourceValidationReason): ExperimentError => {
  const error = new ExperimentError(400, 'INVALID_SOURCE', '生成代码未通过封闭资源、元数据或语法检查。')
  if (reason !== undefined) Object.defineProperty(error, 'sourceValidationReason', { value: reason })
  return error
}
/** Private code has its own viewport baseline, independent of community template chrome. */
const independentStylesheet = `:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#2e3d38;background:#fafaf7;color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{position:relative}#canvas{position:relative;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden}#canvas>canvas,#canvas>svg{display:block;width:100%;height:100%}[hidden]{display:none!important}`
// #canvas is the reserved viewport. Author CSS may decorate it, but must not
// shrink the coordinate surface which renderFrame measures with clientWidth.
const independentViewportStyle = 'position:fixed!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;box-sizing:border-box!important'
const independentHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PhysicsOS experiment</title><link rel="stylesheet" href="./assets/platform-base.css"><link rel="stylesheet" href="./assets/experiment.css"></head>
<body><div hidden><h1 id="title">正在连接实验…</h1><p id="status" role="status">等待实验快照</p></div><div id="canvas" aria-live="off" style="${independentViewportStyle}"></div><div id="parameters" hidden aria-label="实验参数"></div><script type="module" src="./runtime/main.js"></script></body></html>`
interface DrawingFunction {
  name: string
  start: number
  end: number
  bodyStart: number
  bodyEnd: number
  expression: boolean
  parameters: string[][]
  code: string
  bindings: Map<string, string>
  calls: DrawingCall[]
}
interface DrawingCall { name: string; start: number; end: number; arguments: string[] }
interface DrawingSvgExpression { expression: string; start: number; receiver: string }
const drawingNames = (text: string): string[] => text.match(/[A-Za-z_$][\w$]*/g) ?? []
/** Strings/comments are masked in place, preserving source spans for reachable inline SVG. */
function drawingCode(source: string): string {
  return source.replace(
    /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    token => /^(?:["'](?:2d|canvas|http:\/\/www\.w3\.org\/2000\/svg|svg|circle|ellipse|path|line|polyline|polygon|rect|view|cx|cy|x|y|x1|x2|y1|y2|d|points|r|rx|ry|width|height|transform)["'])$/.test(token) ? token : ' '.repeat(token.length),
  )
}
function drawingBlockEnd(code: string, start: number): number {
  const close = code[start] === '(' ? ')' : '}'
  let depth = 1
  for (let index = start + 1; index < code.length; index++) {
    if (code[index] === code[start]) depth++
    if (code[index] === close && --depth === 0) return index + 1
  }
  throw new Error('Unclosed drawing function')
}
function drawingExpressionEnd(code: string, start: number): number {
  let depth = 0
  for (let index = start; index < code.length; index++) {
    const char = code[index]
    if (depth === 0 && (char === ',' || char === ';' || char === '\n' || char === '}')) return index
    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--
  }
  return code.length
}
function drawingArguments(code: string, original = code): string[] {
  const parts: string[] = []
  let start = 0, depth = 0
  for (let index = 0; index < code.length; index++) {
    const char = code[index]
    if (char === ',' && depth === 0) {
      parts.push(original.slice(start, index).trim())
      start = index + 1
    }
    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--
  }
  if (original.slice(start).trim()) parts.push(original.slice(start).trim())
  return parts
}
/** Remove only balanced groups which enclose the entire value expression. */
function drawingUngroup(expression: string): string {
  let value = expression.trim()
  for (let depth = 0; depth < 64 && value[0] === '('; depth++) {
    if (drawingBlockEnd(value, 0) !== value.length) break
    value = value.slice(1, -1).trim()
  }
  return value
}
/** These fallback values contain no apparatus or coordinates that could serve
 * as drawing provenance. Parse data only; never evaluate authored JavaScript. */
function drawingEmptyViewFallback(expression: string): boolean {
  const text = drawingUngroup(expression)
  if (text === 'null') return true
  if (!text.startsWith('{') || !text.endsWith('}')) return false
  // Masked strings/templates/comments become spaces. Only adjacent [] proves
  // that an array was empty in the authored source, rather than merely masked.
  if (/\[(?!\])/.test(text)) return false
  let parsed: unknown
  try { parsed = JSON.parse(text.replace(/\b([A-Za-z_$][\w$]*)\s*:/g, '"$1":')) } catch { return false }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const arrays = new Set(['bodies', 'particles', 'vectors', 'trajectories', 'keyPoints', 'angles', 'dimensions', 'labels', 'guides', 'motionMarks'])
  return Object.entries(parsed).every(([key, value]) => {
    if (key !== 'extent' && key !== 'origin') return arrays.has(key) && Array.isArray(value) && value.length === 0
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>, names = key === 'extent' ? ['width', 'height'] : ['x', 'y']
    return Object.keys(record).length === 2 && names.every(name => typeof record[name] === 'number' && Number.isFinite(record[name]))
  })
}
/** A same-object null guard contributes only its .view value, including the
 * observed grouped form with null or an empty static view as its fallback. */
function drawingViewGuard(expression: string): string | undefined {
  const value = drawingUngroup(expression)
  const guard = /^\s*([A-Za-z_$][\w$]*)\s*&&\s*\1\s*\.\s*view\s*$/
  const direct = guard.exec(value)
  if (direct?.[1] !== undefined) return direct[1]
  let depth = 0
  for (let index = 0; index < value.length - 1; index++) {
    const char = value[index]
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') depth--
    else if (depth === 0 && char === '|' && value[index + 1] === '|') {
      const left = guard.exec(drawingUngroup(value.slice(0, index)))
      return left?.[1] !== undefined && drawingEmptyViewFallback(value.slice(index + 2)) ? left[1] : undefined
    }
  }
  return undefined
}
function drawingCalls(code: string): DrawingCall[] {
  const calls: DrawingCall[] = []
  for (const match of code.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const start = match.index, open = start + match[0].lastIndexOf('('), end = drawingBlockEnd(code, open)
    calls.push({ name: match[1] ?? '', start, end, arguments: drawingArguments(code.slice(open + 1, end - 1)) })
    if (calls.length > 4096) throw new Error('Drawing graph is too large')
  }
  return calls
}
/** Read a member-call receiver backwards, keeping nested groups whole and stopping at expression boundaries. */
function drawingCallbackReceiver(code: string, call: DrawingCall): string | undefined {
  let index = call.start - 1
  while (index >= 0 && /\s/.test(code[index] ?? '')) index--
  if (code[index] !== '.') return undefined
  index--
  if (code[index] === '?') index--
  while (index >= 0 && /\s/.test(code[index] ?? '')) index--
  const end = index + 1, groups: string[] = []
  for (; index >= 0; index--) {
    const char = code[index]
    if (char === ')' || char === ']' || char === '}') {
      groups.push(char === ')' ? '(' : char === ']' ? '[' : '{')
      if (groups.length > 64) throw new Error('Drawing receiver is too deep')
    } else if (char === '(' || char === '[' || char === '{') {
      if (!groups.length) break
      if (groups.pop() !== char) throw new Error('Unbalanced drawing receiver')
    } else if (!groups.length && !/[A-Za-z0-9_$?.]/.test(char ?? '')) {
      if (!/\s/.test(char ?? '')) break
      let before = index - 1, after = index + 1
      while (before >= 0 && /\s/.test(code[before] ?? '')) before--
      while (after < end && /\s/.test(code[after] ?? '')) after++
      const word = code.slice(0, before + 1).match(/([A-Za-z_$][\w$]*)$/)?.[1]
      const invocation = (code[after] === '(' || code[after] === '[') &&
        /[A-Za-z0-9_$)\]]/.test(code[before] ?? '') &&
        !['return', 'throw', 'if', 'for', 'while', 'switch', 'catch', 'yield', 'await', 'new', 'typeof', 'void'].includes(word ?? '')
      if (!invocation && code[before] !== '.' && code[after] !== '.' && code[before] !== '?' && code[after] !== '?') break
    }
  }
  if (groups.length) throw new Error('Unclosed drawing receiver')
  return code.slice(index + 1, end).trim() || undefined
}
function drawingBindings(code: string): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const match of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?!=|>)/g)) {
    if (code[match.index - 1] === '.') continue
    const start = match.index + match[0].length
    bindings.set(match[1] ?? '', code.slice(start, drawingExpressionEnd(code, start)))
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*=\s*/g)) {
    const start = match.index + match[0].length, value = code.slice(start, drawingExpressionEnd(code, start))
    for (const name of drawingNames(match[1] ?? '')) bindings.set(name, name === 'view' ? `(${value}).view` : value)
  }
  for (const call of drawingCalls(code)) {
    if (call.name === 'for') {
      const iteration = code.slice(call.start, call.end).match(/^for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([\s\S]*)\)$/)
      if (iteration !== null) bindings.set(iteration[1] ?? '', iteration[2] ?? '')
    }
    if (!['forEach', 'map', 'flatMap', 'reduce'].includes(call.name)) continue
    const receiver = drawingCallbackReceiver(code, call)
    const parameters = call.arguments[0]?.match(/^\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/)
    if (receiver === undefined || parameters === undefined || parameters === null) continue
    for (const name of drawingNames(parameters[1] ?? parameters[2] ?? '')) bindings.set(name, receiver)
  }
  return bindings
}
/** Bounded local call graph, without evaluating authored code or depending on a JS runtime parser. */
function drawingFunctions(code: string): Map<string, DrawingFunction> {
  const functions = new Map<string, DrawingFunction>()
  const declarations = new RegExp(
    String.raw`\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*|` +
    String.raw`\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)|` +
    String.raw`(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>)\s*`,
    'g',
  )
  for (const match of code.matchAll(declarations)) {
    if (code[match.index - 1] === '.') continue
    const name = match[1] ?? match[3] ?? '', body = match.index + match[0].length
    const expression = code[body] !== '{', end = expression ? drawingExpressionEnd(code, body) : drawingBlockEnd(code, body)
    if (functions.has(name) || functions.size >= 256) throw new Error('Ambiguous or oversized local drawing graph')
    functions.set(name, { name, start: match.index, end, bodyStart: expression ? body : body + 1, bodyEnd: expression ? end : end - 1, expression, parameters: drawingArguments(match[2] ?? match[4] ?? match[5] ?? match[6] ?? '').map(drawingNames), code: '', bindings: new Map(), calls: [] })
  }
  for (const fn of functions.values()) {
    const body = code.slice(fn.bodyStart, fn.bodyEnd).split('')
    for (const nested of functions.values()) {
      if (nested.start >= fn.bodyStart && nested.end <= fn.bodyEnd) body.fill(' ', nested.start - fn.bodyStart, nested.end - fn.bodyStart)
    }
    fn.code = body.join('')
    fn.bindings = drawingBindings(fn.code)
    fn.calls = drawingCalls(fn.code)
  }
  return functions
}
const DRAW_FRAME = 1, DRAW_VIEW = 2, DRAW_GEOMETRY = 4
const viewChrome = new Set(['domain', 'extent', 'origin', 'grid', 'axes', 'tickStep', 'tickLabelAvoid', 'overlay', 'visible', 'highlighted'])
/** Only interpolated shape attributes assigned to a reachable browser-native SVG sink count. */
function drawingInlineSvg(source: string, fn: DrawingFunction): DrawingSvgExpression[] {
  const expressions: DrawingSvgExpression[] = []
  for (const sink of fn.code.matchAll(/\.innerHTML\s*=/g)) {
    const receiver = drawingDomReceiver(fn.code.slice(0, sink.index))
    if (receiver === undefined) continue
    const valueStart = sink.index + sink[0].length
    const value = source.slice(fn.bodyStart + valueStart).match(/^\s*(`(?:\\[\s\S]|[^`\\])*`)/)
    if (value === null) continue
    const template = value[1]
    if (template === undefined || !/<svg\b[^>]*>[\s\S]*<\/svg\s*>/i.test(template)) continue
    const templateStart = valueStart + (value[0].length - template.length)
    for (const shape of template.matchAll(/<(?:circle|ellipse|path|line|polyline|polygon)\b[^>]*>/gi)) {
      for (const attribute of shape[0].matchAll(/\b(?:cx|cy|x|y|x1|x2|y1|y2|d|points|r|rx|ry|transform)\s*=\s*(["'])(.*?)\1/g)) {
        const attributeStart = templateStart + shape.index + attribute.index
        const raw = attribute[0]
        for (let index = 0; index < raw.length; index++) {
          if (raw[index] !== '$' || raw[index + 1] !== '{' || raw[index - 1] === '\\') continue
          const masked = drawingCode(raw.slice(index + 1)), end = drawingBlockEnd(masked, 0)
          expressions.push({ expression: masked.slice(1, end - 1), start: attributeStart + index + 2, receiver })
          index += end
        }
      }
    }
  }
  return expressions
}
function drawingReceiver(code: string, call: DrawingCall): string | undefined {
  return code.slice(0, call.start).match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*$/)?.[1]
}
function drawingDomReceiver(prefix: string): string | undefined {
  return prefix.match(/(document\s*\.\s*getElementById\s*\(\s*["']canvas["']\s*\)|[A-Za-z_$][\w$]*)\s*$/)?.[1]
}
/** Static evidence is bound to the exported entry and its called local helpers. */
function validateIndependentDrawing(source: string): void {
  const [imports, exports] = parse(source), frame = exports.find(entry => entry.n === 'renderFrame')
  if (imports.length) throw new DrawingValidationError('module_dependency')
  if (frame?.ln === undefined) throw new DrawingValidationError('missing_export')
  const code = drawingCode(source), functions = drawingFunctions(code), entry = functions.get(frame.ln)
  if (!entry) throw new DrawingValidationError('missing_native_entry')
  if (/\brenderPlatformFrame\b/.test(code)) throw new DrawingValidationError('legacy_renderer')
  const inlineSvg = new Map<DrawingFunction, DrawingSvgExpression[]>()
  for (const fn of functions.values()) {
    const expressions = drawingInlineSvg(source, fn)
    inlineSvg.set(fn, expressions)
    // Include local helpers executed inside an SVG coordinate interpolation in the same call graph.
    for (const part of expressions) {
      for (const call of drawingCalls(part.expression)) {
        fn.calls.push({ ...call, start: call.start + part.start, end: call.end + part.start })
      }
    }
    fn.calls.sort((left, right) => left.start - right.start)
  }
  const reachable = new Set<DrawingFunction>()
  const incoming = new Map<string, { caller: DrawingFunction; arguments: string[]; rawArguments: string[] }[]>()
  const visit = (fn: DrawingFunction): void => {
    if (reachable.has(fn)) return
    reachable.add(fn)
    for (const call of fn.calls) {
      const callee = functions.get(call.name)
      // Member calls are native API calls, not bare local function delegation.
      if (!callee || fn.code[call.start - 1] === '.') continue
      const calls = incoming.get(callee.name) ?? []
      const open = fn.code.indexOf('(', call.start)
      const rawArguments = drawingArguments(
        fn.code.slice(open + 1, call.end - 1), source.slice(fn.bodyStart + open + 1, fn.bodyStart + call.end - 1),
      )
      calls.push({ caller: fn, arguments: call.arguments, rawArguments }); incoming.set(callee.name, calls)
      visit(callee)
    }
  }
  visit(entry)
  const globalCode = code.split('')
  for (const fn of functions.values()) globalCode.fill(' ', fn.start, fn.end)
  const globals = drawingBindings(globalCode.join(''))
  const globalNames = new Set([...globalCode.join('').matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1] ?? ''))
  const assignedGlobals = new Map<string, { fn: DrawingFunction; value: string }>()
  for (const fn of reachable) {
    for (const [name, value] of fn.bindings) {
      if (globalNames.has(name) && !new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(fn.code)) assignedGlobals.set(name, { fn, value })
    }
  }
  const nodeIdentities = (expression: string, fn: DrawingFunction, seen: Set<string> = new Set()): string[] => {
    if (seen.size > 64) return []
    if (/^\s*document\s*\.\s*getElementById\s*\(\s*["']canvas["']\s*\)\s*$/.test(expression)) return ['stage']
    const name = expression.trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return []
    const key = `${fn.name}:${name}`
    if (seen.has(key)) return []
    const next = new Set(seen).add(key)
    const local = fn.bindings.get(name)
    const assigned = assignedGlobals.get(name)
    const binding = local === undefined
      ? assigned === undefined ? globals.get(name) : assigned.value
      : local
    if (binding !== undefined) {
      const owner = local === undefined && assigned !== undefined ? assigned.fn : fn
      if (/^\s*document\s*\.\s*createElement(?:NS)?\s*\(/.test(binding)) {
        const global = globalNames.has(name) && !new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(fn.code)
        return [global ? `global:${name}` : `${owner.name}:${name}`]
      }
      return nodeIdentities(binding, owner, next)
    }
    const parameter = fn.parameters.findIndex(names => names.includes(name))
    return parameter < 0 ? [] : (incoming.get(fn.name) ?? []).flatMap(call =>
      nodeIdentities(call.arguments[parameter] ?? '', call.caller, next))
  }
  // Mount proof follows only calls reached from the exported entry, including local helper parameters/aliases.
  const mounted = new Set(['stage']), mounts: { parents: string[]; children: string[] }[] = []
  for (const fn of reachable) {
    for (const call of fn.calls) {
      if (!['append', 'appendChild', 'replaceChildren'].includes(call.name)) continue
      const prefix = fn.code.slice(0, call.start)
      if (!/\.\s*$/.test(prefix)) continue
      const receiver = drawingDomReceiver(prefix.replace(/\.\s*$/, ''))
      if (receiver !== undefined) mounts.push({
        parents: nodeIdentities(receiver, fn), children: call.arguments.flatMap(argument => nodeIdentities(argument, fn)),
      })
    }
  }
  for (let pass = 0; pass <= mounts.length; pass++) {
    const before = mounted.size
    for (const mount of mounts) {
      if (mount.parents.some(parent => mounted.has(parent))) for (const child of mount.children) mounted.add(child)
    }
    if (mounted.size === before) break
  }
  const classify = (expression: string, fn: DrawingFunction, seen: Set<string> = new Set()): number => {
    if (seen.size > 64) return 0
    // In a same-object guard, only the RHS is the value; the frame operand controls access to its view.
    const guardedView = drawingViewGuard(expression)
    if (guardedView !== undefined) return classify(`${guardedView}.view`, fn, seen)
    let value = 0
    const text = expression.split('')
    // A local helper's result must itself depend on data; merely passing data to a constant helper is insufficient.
    for (const call of drawingCalls(expression)) {
      const callee = functions.get(call.name)
      if (!callee || expression[call.start - 1] === '.') continue
      const key = `return:${callee.name}`
      if (!seen.has(key)) {
        const next = new Set(seen).add(key)
        if (callee.expression) value |= classify(callee.code, callee, next)
        else for (const match of callee.code.matchAll(/\breturn\s*/g)) {
          const start = match.index + match[0].length
          value |= classify(callee.code.slice(start, drawingExpressionEnd(callee.code, start)), callee, next)
        }
      }
      text.fill(' ', call.start, call.end)
    }
    for (const match of text.join('').matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)((?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)/g)) {
      const name = match[1] ?? '', key = `${fn.name}:${name}`
      if (seen.has(key)) continue
      const next = new Set(seen).add(key)
      let kind = 0
      const binding = fn.bindings.get(name)
      if (binding !== undefined) kind = classify(binding, fn, next)
      else {
        const parameter = fn.parameters.findIndex(names => names.includes(name))
        if (fn === entry && parameter === 0) kind = name === 'view' ? DRAW_VIEW : DRAW_FRAME
        else if (parameter >= 0) for (const call of incoming.get(fn.name) ?? []) kind |= classify(call.arguments[parameter] ?? '', call.caller, next)
        else {
          const assigned = assignedGlobals.get(name)
          if (assigned) kind = classify(assigned.value, assigned.fn, next)
          else if (globals.has(name)) kind = classify(globals.get(name) ?? '', fn, next)
        }
      }
      for (const property of drawingNames(match[2] ?? '')) {
        if (kind & DRAW_FRAME) kind = property === 'view' ? DRAW_VIEW : 0
        else if (kind & DRAW_VIEW) kind = viewChrome.has(property) ? 0 : DRAW_GEOMETRY
      }
      value |= kind
    }
    return value
  }
  const active = [...reachable].map(fn => fn.code).join('\n')
  // Array field names are not observable keys. Bind the visibility receiver to
  // the engine view before checking a literal, including the common vis(view,k)
  // helper. Masked source offsets preserve only argument data, never execute it.
  const invalidKeys = new Set(['vectors', 'trajectories', 'motionMarks', 'angles', 'dimensions'])
  const invalidLiteral = (value: string): boolean => {
    const literal = /^\s*(['"])([A-Za-z_$][\w$]*)\1\s*$/.exec(value)
    return literal !== null && invalidKeys.has(literal[2] ?? '')
  }
  for (const fn of reachable) {
    for (const match of fn.code.matchAll(
      /\b([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*\??\.\s*visible\s*(?:\?\.)?\s*(?:\[([^\]]+)\]|\.\s*([A-Za-z_$][\w$]*))/g,
    )) {
      const receiver = match[1] ?? '', raw = source.slice(fn.bodyStart + match.index, fn.bodyStart + match.index + match[0].length)
      const bracket = raw.indexOf('[')
      const key = bracket >= 0 ? raw.slice(bracket + 1, raw.lastIndexOf(']')).trim() : `'${match[3] ?? ''}'`
      if (invalidLiteral(key) && (classify(receiver, fn) & DRAW_VIEW) !== 0) throw new DrawingValidationError('invalid_visibility_key')
      const receiverIndex = fn.parameters.findIndex(names => names.includes(receiver.trim()))
      const keyIndex = fn.parameters.findIndex(names => names.includes(key))
      if (receiverIndex < 0 || keyIndex < 0) continue
      for (const call of incoming.get(fn.name) ?? []) {
        if ((classify(call.arguments[receiverIndex] ?? '', call.caller) & DRAW_VIEW) !== 0
          && invalidLiteral(call.rawArguments[keyIndex] ?? '')) throw new DrawingValidationError('invalid_visibility_key')
      }
    }
  }
  const svgGeometry = [...reachable].some(fn =>
    (inlineSvg.get(fn) ?? []).some(part =>
      nodeIdentities(part.receiver, fn).some(node => mounted.has(node)) &&
      (classify(part.expression, fn) & DRAW_GEOMETRY) !== 0))
  const geometry = svgGeometry || [...reachable].some((fn) => {
    const transforms = new Map<string, number>(), saved = new Map<string, number[]>()
    for (const call of fn.calls) {
      const receiver = drawingReceiver(fn.code, call)
      if (receiver === undefined) continue
      const argumentsKind = call.arguments.reduce((kind, argument) => kind | classify(argument, fn), 0)
      if (call.name === 'save') {
        const stack = saved.get(receiver) ?? []
        stack.push(transforms.get(receiver) ?? 0); saved.set(receiver, stack)
      } else if (call.name === 'restore') {
        const restored = saved.get(receiver)?.pop()
        if (restored !== undefined) transforms.set(receiver, restored)
      } else if (call.name === 'resetTransform' || call.name === 'setTransform') {
        transforms.set(receiver, call.name === 'resetTransform' ? 0 : argumentsKind)
      } else if (['translate', 'scale', 'rotate', 'transform'].includes(call.name)) {
        transforms.set(receiver, (transforms.get(receiver) ?? 0) | argumentsKind)
      } else if (['arc', 'ellipse', 'rect', 'moveTo', 'lineTo', 'fillRect', 'strokeRect'].includes(call.name)) {
        if (((argumentsKind | (transforms.get(receiver) ?? 0)) & DRAW_GEOMETRY) !== 0) return true
      } else if (call.name === 'drawImage' && [3, 5, 9].includes(call.arguments.length)) {
        const destination = call.arguments.slice(call.arguments.length === 9 ? 5 : 1)
        const destinationKind = destination.reduce((kind, argument) => kind | classify(argument, fn), 0)
        if (((destinationKind | (transforms.get(receiver) ?? 0)) & DRAW_GEOMETRY) !== 0) return true
      } else if (call.name === 'setAttribute' && call.arguments.slice(1).some(argument => (classify(argument, fn) & DRAW_GEOMETRY) !== 0)) return true
    }
    return false
  })
  if (!geometry) throw new DrawingValidationError('missing_engine_geometry')
  // Context creation and mounting may occur once at module scope; painting and data cannot be borrowed from unused functions.
  const rectangles = [...active.matchAll(/\.(?:fillRect|strokeRect)\s*\(/g)].length >= 2
  const canvas = /\.getContext\s*\(\s*["']2d["']/.test(code) &&
    ((/\.(?:arc|ellipse|rect)\s*\(|\.moveTo\s*\([\s\S]*?\.lineTo\s*\(/.test(active) && /\.(?:fill|stroke)\s*\(/.test(active)) ||
      rectangles || /\.drawImage\s*\(/.test(active)) && /\.(?:append|appendChild|replaceChildren)\s*\(/.test(code)
  const svg = svgGeometry || /\.createElementNS\s*\(/.test(code) &&
    /["'](?:circle|ellipse|path|line|polyline|polygon)["']/.test(code) &&
    /\.setAttribute\s*\(/.test(active) && /\.(?:append|appendChild|replaceChildren)\s*\(/.test(code)
  if (!canvas && !svg) throw new DrawingValidationError('missing_native_drawing')
}
const recordHash = (record: Omit<QuestionCodeRecord, 'sha256'> | QuestionCodeRecord): string => {
  const { sha256: _ignored, ...body } = record as QuestionCodeRecord
  return hash(canonicalQuestionJson(body))
}
const project = (row: QuestionCodeRecord): CodeExperimentRef => ({
  status: 'ready',
  artifactId: row.id,
  ownerSessionId: row.ownerSessionId,
  childSessionId: row.childSessionId,
  sceneId: row.sceneId,
  sceneRevision: row.sceneRevision,
  sceneSha256: row.sceneSha256,
  experimentId: row.experimentId,
  sha256: row.sha256,
  title: row.title,
  ...(row.rendererKind === undefined ? {} : { rendererKind: row.rendererKind }),
  createdAt: row.createdAt,
})
async function verifiedFile(
  path: string,
  expected: { sha256: string; size: number },
): Promise<Buffer> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== expected.size || stat.size > 20 * 1024 * 1024)
      throw new Error('invalid file')
    const bytes = await handle.readFile()
    if (hash(bytes) !== expected.sha256) throw new Error('digest mismatch')
    return bytes
  } catch {
    throw new ExperimentError(409, 'INTEGRITY_MISMATCH', '冻结的题目实验文件校验失败。')
  } finally {
    await handle?.close()
  }
}
async function durableFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o400)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* Content-addressed blobs are shared by every account. A blob only appears at
   its final name through link() after a complete, fsynced write, so neither a
   concurrent create nor a crash can expose a partial file; a corrupt blob already
   at the final name (an interrupted in-place write) is replaced with verified bytes. */
async function publishBlob(directory: string, digest: string, bytes: Buffer): Promise<void> {
  const path = join(directory, digest)
  const temporary = join(directory, `.${digest}.${randomBytes(8).toString('hex')}.tmp`)
  await durableFile(temporary, bytes)
  try {
    try {
      await link(temporary, path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    try {
      await verifiedFile(path, { sha256: digest, size: bytes.length })
    } catch {
      await rename(temporary, path)
    }
  } finally {
    await rm(temporary, { force: true })
  }
}
/** Runs at most `limit` tasks at once; a finished task hands its slot to the next waiter. */
class Gate {
  private active = 0
  private readonly waiting: (() => void)[] = []
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active += 1
    else await new Promise<void>((resolve) => { this.waiting.push(resolve) })
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next === undefined) this.active -= 1
      else next()
    }
  }
}
interface Capability {
  id: string
  sha256: string
  expiresAt: number
  nonce: string
}
export class QuestionCodeArtifactService implements QuestionCodeArtifacts {
  /* Each syntax check forks a Node process: concurrent accounts overlap, but
     the forks stay bounded. */
  private readonly syntaxChecks = new Gate(2)
  private readonly inflight = new Set<Promise<unknown>>()
  private initialized = false
  private secret: Buffer | undefined
  private readonly root: string
  readonly assetOrigin: string | undefined
  private readonly ttl: number
  private readonly imageAssets: QuestionCodeAssets
  constructor(
    private readonly domain: Domain<typeof questionCodeDomain>,
    private readonly options: QuestionCodeOptions,
  ) {
    this.root = resolve(options.root)
    this.imageAssets = options.imageAssets ?? new QuestionCodeAssets()
    this.ttl = Math.min(15 * 60_000, Math.max(1, options.previewTtlMs ?? 10 * 60_000))
    if (options.assetOrigin !== undefined) {
      const origin = new URL(options.assetOrigin)
      if (
        !['http:', 'https:'].includes(origin.protocol) ||
        origin.origin !== options.assetOrigin ||
        origin.username ||
        origin.password
      )
        throw new Error('Invalid asset origin')
      this.assetOrigin = origin.origin
    }
  }
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await mkdir(join(this.root, 'blobs'), { recursive: true, mode: 0o700 })
    await mkdir(join(this.root, 'checks'), { recursive: true, mode: 0o700 })
    const keyPath = join(this.root, 'capability-key')
    try {
      await durableFile(keyPath, randomBytes(32))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const handle = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0)
        throw new Error('Invalid private capability key')
      this.secret = await handle.readFile()
    } finally {
      await handle.close()
    }
    for (const [id, row] of this.domain.table('artifacts').entries()) {
      this.checked(row)
      if (id !== row.id) throw new Error('Invalid artifact identity')
    }
    const rootDirectory = await open(this.root, 'r')
    try {
      await rootDirectory.sync()
    } finally {
      await rootDirectory.close()
    }
    this.initialized = true
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.inflight])
  }
  private requireReady(): void {
    if (!this.initialized || !this.secret)
      throw new ExperimentError(503, 'ARTIFACTS_UNAVAILABLE', '题目实验存储尚未就绪。')
  }
  private signingKey(): Buffer {
    this.requireReady()
    const key = this.secret
    if (key === undefined) throw new ExperimentError(503, 'ARTIFACTS_UNAVAILABLE', '题目实验存储尚未就绪。')
    return key
  }
  private owner(sessionId: string): string | undefined {
    return this.options.identity()?.sessionOwnerKey(sessionId)
  }
  private checked(row: QuestionCodeRecord): QuestionCodeRecord {
    const parsed = questionCodeRecordSchema.parse(row)
    if (
      recordHash(parsed) !== parsed.sha256 ||
      !experimentProfile(parsed.experimentId) ||
      parsed.files.some(file => !safeArchivePath(file.name)) ||
      new Set(parsed.files.map(file => file.name)).size !== parsed.files.length
    )
      throw new ExperimentError(409, 'INTEGRITY_MISMATCH', '题目实验身份校验失败。')
    return parsed
  }
  private record(id: string): QuestionCodeRecord {
    this.requireReady()
    if (!/^qcode_[a-f0-9]{32}$/.test(id)) throw missing()
    const row = this.domain.table('artifacts').get(id)
    if (!row) throw missing()
    return this.checked(row)
  }
  describe(ownerSessionId: string, artifactId: string, expectedSha256: string): CodeExperimentRef {
    const row = this.record(artifactId)
    if (row.ownerSessionId !== ownerSessionId || this.owner(ownerSessionId) !== row.ownerKey)
      throw missing()
    if (row.sha256 !== expectedSha256)
      throw new ExperimentError(409, 'ARTIFACT_REF_MISMATCH', '题目实验引用摘要不一致。')
    return project(row)
  }
  context(experimentId: string): Promise<QuestionCodeContext> {
    return Promise.resolve().then(() => questionCodeContext(experimentId, this.options.prompts))
  }
  private assetBinding(input: QuestionAssetScope) {
    this.requireReady()
    const ownerKey = this.owner(input.ownerSessionId)
    if (!ownerKey) throw new ExperimentError(403, 'SESSION_OWNER_UNAVAILABLE', '对话账号身份不可用。')
    if (validateScene(input.scene as PhysicsScene).status === 'failed') throw new ExperimentError(400, 'INVALID_SCENE', '题目场景无效。')
    return { ownerSessionId: input.ownerSessionId, ownerKey, generationId: input.generationId,
      sceneSha256: questionSceneSha256(input.scene as PhysicsScene) }
  }
  generateAsset(input: QuestionAssetRequest): Promise<QuestionAssetDescriptor> {
    return this.imageAssets.generate({ ...this.assetBinding(input), prompt: input.prompt, kind: input.kind, signal: input.signal })
  }
  assetManifest(input: QuestionAssetScope): QuestionAssetDescriptor[] { return this.imageAssets.manifest(this.assetBinding(input)) }
  async create(input: CreateQuestionCodeInput, signal?: AbortSignal): Promise<CodeExperimentRef> {
    const operation = this.build(input, signal)
    this.inflight.add(operation)
    void operation.finally(() => { this.inflight.delete(operation) }).catch(() => {})
    return operation
  }
  /* Creates overlap freely: blob publication is the only shared file state and is
     atomic per digest, and rows land on the domain's write chain. A caller that
     gave up is honoured before each durable step, so it never leaves an orphan row. */
  private async build(input: CreateQuestionCodeInput, signal: AbortSignal | undefined): Promise<CodeExperimentRef> {
    const stillWanted = (): void => {
      if (signal?.aborted === true) throw new ExperimentError(499, 'GENERATION_ABORTED', '题目实验生成已取消。')
    }
    stillWanted()
    this.requireReady()
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw invalidSource()
    const ownerKey = this.owner(input.ownerSessionId)
    if (!ownerKey)
      throw new ExperimentError(
        403,
        'SESSION_OWNER_UNAVAILABLE',
        '对话必须已有可验证的账号归属。',
      )
    const scene = structuredClone(input.scene)
    try {
      if (validateScene(scene).status === 'failed') throw new Error('invalid scene')
    } catch {
      throw new ExperimentError(400, 'INVALID_SCENE', '题目物理场景未通过校验。')
    }
    const profile = experimentProfile(input.experimentId)
    const selected = pickEngine(scene)
    if (!profile || !selected.entry || profile.domain !== domainOfEngine(selected.entry.engine))
      throw new ExperimentError(400, 'SCENE_PROFILE_MISMATCH', '实验风格与题目物理领域不一致。')
    const source = parsed.data.source
    if (Buffer.byteLength(canonicalQuestionJson(source), 'utf8') > 128 * 1024)
      throw new ExperimentError(413, 'SOURCE_TOO_LARGE', '生成代码不能超过 128 KiB。')
    const styleVersion = styleVersionOf(this.options.prompts?.current()),
      files = experimentTemplateFiles(input.experimentId)
    if (input.generationId !== undefined) {
      const binding = this.assetBinding({ ownerSessionId: input.ownerSessionId, generationId: input.generationId, scene })
      if (!this.imageAssets.manifest(binding).length) throw new ExperimentError(400, 'IMAGE_REQUIRED', '请先生成本题实验素材。')
      const generated = this.imageAssets.files(binding, source.rendererJs, source.stylesheet)
      for (const [name, bytes] of generated) files.set(name, bytes)
      const licenses: unknown = JSON.parse(files.get('ASSET-LICENSES.json')?.toString('utf8') ?? '[]')
      if (!Array.isArray(licenses)) throw invalidSource()
      files.set('ASSET-LICENSES.json', Buffer.from(JSON.stringify([...(licenses as unknown[]), { path: 'dist/assets/generated/*', name: 'Question-specific generated appearance assets', source: 'https://image.haqiuhaqiu.xyz', license: 'LicenseRef-Generated-Provider-Terms', notice: 'dist/assets/generated/provenance.json' }], null, 2)))
    } else if (/assets\/generated\//.test(source.rendererJs + source.stylesheet)) throw invalidSource()
    files.set('public/assets/platform-base.css', Buffer.from(independentStylesheet))
    files.set('dist/assets/platform-base.css', Buffer.from(independentStylesheet))
    // Keep the trusted SDK, but replace community chrome with the generic authored viewport.
    for (const name of ['public/index.html', 'dist/index.html']) {
      files.set(name, Buffer.from(independentHtml))
    }
    const bootstrap = files.get('src/main.js')
    if (bootstrap === undefined) throw invalidSource()
    const privateBootstrap = Buffer.from(bootstrap.toString('utf8') + `
document.addEventListener('physicsos-experiment-intent', event => {
  connection.send(event.detail)
})
` + CANVAS_TEXT_SHIM)
    files.set('src/main.js', privateBootstrap)
    files.set('dist/runtime/main.js', privateBootstrap)
    files.set('src/renderer.js', Buffer.from(source.rendererJs))
    files.set('dist/runtime/renderer.js', Buffer.from(source.rendererJs))
    files.set('public/assets/experiment.css', Buffer.from(source.stylesheet))
    files.set('dist/assets/experiment.css', Buffer.from(source.stylesheet))
    try {
      // The resource and drawing checks below lex the renderer, so Node's own syntax verdict comes first.
      await this.checkSyntax(source.rendererJs)
      const manifestBytes = files.get('experiment.json')
      if (manifestBytes === undefined) throw invalidSource()
      const manifest = manifestV3Schema.parse(JSON.parse(manifestBytes.toString('utf8')))
      if (validatePackageMetadataV3(files, manifest).length) throw new Error('metadata')
      await validatePackageResources(files, manifest)
      await init
      validateIndependentDrawing(source.rendererJs)
    } catch (error) {
      throw invalidSource(error instanceof DrawingValidationError ? error.reason : undefined)
    }
    files.set('question-scene.json', Buffer.from(canonicalQuestionJson(scene)))
    stillWanted()
    const frozen: QuestionCodeRecord['files'] = []
    for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      const digest = hash(bytes)
      await publishBlob(join(this.root, 'blobs'), digest, bytes)
      frozen.push({
        name,
        sha256: digest,
        size: bytes.length,
        contentType: assetContentType(name) ?? 'application/octet-stream',
      })
    }
    const row: QuestionCodeRecord = {
      id: 'qcode_' + randomBytes(16).toString('hex'),
      ownerSessionId: input.ownerSessionId,
      ownerKey,
      childSessionId: input.childSessionId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      sceneSha256: questionSceneSha256(scene),
      experimentId: input.experimentId,
      sha256: '',
      title: source.title,
      rendererKind: 'independent',
      summary: source.summary,
      createdAt: new Date().toISOString(),
      styleVersion,
      files: frozen,
    }
    row.sha256 = recordHash(row)
    this.checked(row)
    const blobsDirectory = await open(join(this.root, 'blobs'), 'r')
    try {
      await blobsDirectory.sync()
    } finally {
      await blobsDirectory.close()
    }
    // A deleted/reclaimed session during generation cannot acquire a completed artifact.
    if (this.owner(input.ownerSessionId) !== ownerKey) throw missing()
    stillWanted()
    await this.domain.table('artifacts').put(row.id, row)
    return project(row)
  }
  private async checkSyntax(rendererJs: string): Promise<void> {
    const checkDir = await mkdtemp(join(this.root, 'checks', 'renderer-'))
    try {
      const rendererPath = join(checkDir, 'renderer.mjs')
      await durableFile(rendererPath, Buffer.from(rendererJs))
      // Fixed executable and options, service-owned path, syntax only. Uploaded code is never run.
      await this.syntaxChecks.run(() => executeFile(process.execPath, ['--check', rendererPath], {
        timeout: 5000,
        maxBuffer: 4096,
        env: { PATH: process.env.PATH ?? '' },
      }))
    } catch (error) {
      // Only Node's completed verdict is the author's error; a timed-out or killed check is not.
      const failure = error as { code?: unknown; killed?: unknown; stderr?: unknown }
      if (failure.code === 1 && failure.killed !== true && String(failure.stderr).includes('SyntaxError'))
        throw new DrawingValidationError('syntax_error')
      throw error
    } finally {
      await rm(checkDir, { recursive: true, force: true })
    }
  }
  private authorized(
    actor: IdentityActor,
    id: string,
    expectedSha256?: string,
  ): QuestionCodeRecord {
    const row = this.record(id)
    if (actor.userKey !== row.ownerKey || this.owner(row.ownerSessionId) !== actor.userKey)
      throw missing()
    if (expectedSha256 !== undefined && expectedSha256 !== row.sha256)
      throw new ExperimentError(409, 'ARTIFACT_REF_MISMATCH', '题目实验引用摘要不一致。')
    return row
  }
  preview(
    actor: IdentityActor,
    id: string,
    expectedSha256?: string,
  ): { entryUrl: string; expiresAt: number } {
    const row = this.authorized(actor, id, expectedSha256),
      expiresAt = Date.now() + this.ttl
    const body = Buffer.from(
      JSON.stringify({
        id: row.id,
        sha256: row.sha256,
        expiresAt,
        nonce: randomBytes(12).toString('hex'),
      } satisfies Capability),
    ).toString('base64url')
    const signature = createHmac('sha256', this.signingKey())
      .update('physicsos-question-code-v1:' + body)
      .digest('base64url')
    const path = `${ASSET_PREFIX}/embed/question/${body}.${signature}/dist/index.html`
    return { entryUrl: this.assetOrigin ? new URL(path, this.assetOrigin).href : path, expiresAt }
  }
  async source(
    actor: IdentityActor,
    id: string,
    expectedSha256?: string,
  ): Promise<{ ref: CodeExperimentRef; source: CodeVisualizationSource }> {
    const row = this.authorized(actor, id, expectedSha256)
    const read = async (name: string): Promise<string> => {
      const file = row.files.find(entry => entry.name === name)
      if (!file) throw missing()
      return (await verifiedFile(join(this.root, 'blobs', file.sha256), file)).toString('utf8')
    }
    const [rendererJs, stylesheet] = await Promise.all([
      read('src/renderer.js'),
      read('public/assets/experiment.css'),
    ])
    return {
      ref: project(row),
      source: { title: row.title, summary: row.summary, rendererJs, stylesheet },
    }
  }
  async asset(url: URL): Promise<Asset | undefined> {
    this.requireReady()
    const match =
      /^\/physicsos\/experiment-assets\/question\/([A-Za-z0-9_-]{1,800})\.([A-Za-z0-9_-]{43})\/(.+)$/.exec(
        url.pathname,
      )
    if (
      !match?.[1] ||
      !match[2] ||
      !match[3] ||
      !safeArchivePath(match[3]) ||
      !match[3].startsWith('dist/')
    )
      return undefined
    const expected = createHmac('sha256', this.signingKey())
        .update('physicsos-question-code-v1:' + match[1])
        .digest(),
      supplied = Buffer.from(match[2], 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return undefined
    let capability: Capability
    try {
      capability = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as Capability
    } catch {
      return undefined
    }
    if (
      !Number.isSafeInteger(capability.expiresAt) ||
      capability.expiresAt <= Date.now() ||
      capability.expiresAt > Date.now() + 15 * 60_000
    )
      return undefined
    let row: QuestionCodeRecord
    try {
      row = this.record(capability.id)
    } catch (error) {
      if (error instanceof ExperimentError && error.status === 404) return undefined
      throw error
    }
    if (capability.sha256 !== row.sha256 || this.owner(row.ownerSessionId) !== row.ownerKey)
      return undefined
    const file = row.files.find(item => item.name === match[3])
    if (!file) return undefined
    return {
      protocolVersion: 3,
      bytes: await verifiedFile(join(this.root, 'blobs', file.sha256), file),
      contentType: file.contentType,
      scopePath: `${ASSET_PREFIX}/question/${match[1]}.${match[2]}/dist/`,
      immutable: false,
      sha256: file.sha256,
    }
  }
}
