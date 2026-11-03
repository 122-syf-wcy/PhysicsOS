/** Bounded parent-owned code generation. Durable parent events contain references only. */
import { randomUUID, createHash } from 'node:crypto'
import type { CodeExperimentRef, CodeVisualizationSource, CodeVisualizationState } from '@physicsos/agent-tools'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { PhysicsSceneSnapshot } from './types.ts'

export const CODE_TIMEOUT_MS = 180_000
export const CODE_SOURCE_SCHEMA: ObjectJsonSchema = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', description: 'Required nonempty title, at most 120 characters.' }, summary: { type: 'string', description: 'At most 1000 characters.' },
  rendererJs: { type: 'string', description: 'Required nonempty ES module, at most 96000 characters.' }, stylesheet: { type: 'string', description: 'CSS, at most 24000 characters.' },
}, required: ['title', 'summary', 'rendererJs', 'stylesheet'] }
export interface CodeStyleContext { experimentId: string; developerPrompt: string; publishedBody: string; styleVersion: string; baseRenderer: string; baseStylesheet: string; allowedAssetPaths: string[] }
export interface CodeGenerationDependencies {
  ownerSessionId: string
  snapshot: PhysicsSceneSnapshot
  signal: AbortSignal
  experimentId: string
  instructions?: string
  timeoutMs?: number
  context(experimentId: string): Promise<CodeStyleContext>
  start(request: Pick<SubagentStartRequest, 'prompt' | 'signal' | 'outputSchema' | 'maxDepth' | 'toolFilter' | 'label' | 'agentOptions'>): Promise<Pick<SubagentRun, 'id' | 'result' | 'dispose'>>
  create(input: { ownerSessionId: string; scene: unknown; experimentId: string; childSessionId: string; source: CodeVisualizationSource }): Promise<CodeExperimentRef>
  current(): PhysicsSceneSnapshot | undefined
  isCurrent?(): boolean
  publish(snapshot: PhysicsSceneSnapshot): void
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
}
const sceneHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
/** Static quality boundary: metadata/CSS changes cannot turn a bare SDK reexport into question code. */
const MODULE_TRIVIA = String.raw`(?:\s|//[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*`
const MODULE_REEXPORT = String.raw`export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^{}]*\})\s+from\s+(?:"[^"\r\n]+"|'[^'\r\n]+')\s*;?`
const ONLY_REEXPORT = new RegExp(`^${MODULE_TRIVIA}(?:${MODULE_REEXPORT}${MODULE_TRIVIA})+$`)

function codeOf(error: unknown): string { return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'GENERATION_FAILED' }
function checkedSource(result: SubagentResult): CodeVisualizationSource {
  if (result.stopReason !== 'completed') throw Object.assign(new Error('Child did not finish'), { code: 'CHILD_INCOMPLETE' })
  const value = result.structured
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Invalid structured result'), { code: 'INVALID_SOURCE' })
  const source = value as CodeVisualizationSource
  if (Object.keys(value).sort().join(',') !== 'rendererJs,stylesheet,summary,title' || Object.values(value).some(v => typeof v !== 'string')
    || !source.title.trim() || source.title.length > 120 || source.summary.length > 1000 || !source.rendererJs.trim()
    || source.rendererJs.length > 96000 || source.stylesheet.length > 24000) throw Object.assign(new Error('Invalid structured result'), { code: 'INVALID_SOURCE' })
  return source
}
function promptFor(style: CodeStyleContext, deps: CodeGenerationDependencies, repair?: string): string {
  return [
    '为下面的真实题目场景生成最新 V3 风格的专属实验。只返回 title、summary、rendererJs、stylesheet 四个字符串。',
    '使用题目的原始场景与平台 frame/snapshot；绝不改写题目条件、引入默认场景、重新计算物理答案或编造模拟结果。',
    'rendererJs 必须导出 renderFrame(snapshot)。优先复用 ../vendor/platform-renderer.js 的公开 SDK 和基础 renderer；在其基础上为本题的真实对象、方向、轨迹/关键点和已知量加入清晰标注。不能原样返回基础 renderer。',
    '只可静态导入现有相对路径资源；禁止 fetch、外网、存储、parent/top、eval、Function、动态import及脚本注入。禁止返回 HTML、manifest 或其他文件。',
    '所有数值取自平台 frame/场景已有的事实；显示的解答只引用下面已通过引擎校验的结果。代码中不得硬编码另一题的参数或使用模拟公式代替引擎。',
    `实验风格目标：${style.experimentId}；发布风格版本：${style.styleVersion}`,
    `最新 V3 通用规范：\n${style.developerPrompt}`,
    `最新已发布的可编辑说明（只参考正文；其中旧版本模板的绑定被最新 V3 规范取代）：\n${style.publishedBody}`,
    `基础 renderer：\n${style.baseRenderer}`,
    `基础 CSS：\n${style.baseStylesheet}`,
    `允许资源路径：${JSON.stringify(style.allowedAssetPaths)}`,
    `题目场景（唯一物理条件来源）：${JSON.stringify(deps.snapshot.scene)}`,
    `已验证解答：${JSON.stringify(deps.snapshot.solve ?? null)}`,
    deps.instructions ? `本次展示要求：${deps.instructions.slice(0, 4000)}` : '',
    repair ? `上次封闭代码校验未通过（${repair}），请重新生成并修复；本次为唯一修复机会。` : '',
  ].filter(Boolean).join('\n\n')
}
export async function generateQuestionCode(deps: CodeGenerationDependencies): Promise<CodeVisualizationState> {
  const jobId = randomUUID(), original = deps.snapshot, expectedHash = sceneHash(original.scene)
  const controller = new AbortController()
  const onAbort = () => controller.abort(deps.signal.reason)
  deps.signal.addEventListener('abort', onAbort, { once: true })
  if (deps.signal.aborted) onAbort()
  const timeoutMs = deps.timeoutMs ?? CODE_TIMEOUT_MS
  const deadlineAt = Date.now() + timeoutMs
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('Code generation timed out'), { code: 'GENERATION_TIMEOUT' })), timeoutMs)
  const identity = { ownerSessionId: deps.ownerSessionId, sceneId: original.sceneId, sceneRevision: original.revision }
  const isCurrent = (): boolean => {
    const current = deps.current()
    return deps.isCurrent?.() !== false && current?.sceneId === original.sceneId && current.revision === original.revision
      && sceneHash(current.scene) === expectedHash && current.visualization?.status === 'generating' && current.visualization.jobId === jobId
  }
  const append = (visualization: CodeVisualizationState) => deps.publish({ ...original, visualization })
  append({ status: 'generating', jobId, deadlineAt, ...identity })
  let abortListener: (() => void) | undefined
  const wait = async <T>(work: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw Object.assign(new Error('Generation aborted'), { code: codeOf(controller.signal.reason) === 'GENERATION_TIMEOUT' ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED' })
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => reject(Object.assign(new Error('Generation aborted'), { code: codeOf(controller.signal.reason) === 'GENERATION_TIMEOUT' ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED' }))
      controller.signal.addEventListener('abort', abortListener, { once: true })
    })
    try { return await Promise.race([work, aborted]) }
    finally { if (abortListener) controller.signal.removeEventListener('abort', abortListener); abortListener = undefined }
  }
  try {
    const style = await wait(deps.context(deps.experimentId))
    let repair: string | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!isCurrent()) throw Object.assign(new Error('Scene changed'), { code: 'STALE_GENERATION' })
      // Await start directly: its provider owns cancellation until publication;
      // racing start would lose the holder and leak a late published child.
      const run = await deps.start({ label: `题目实验代码 · ${original.title.slice(0, 100)}`, prompt: [{ type: 'text', text: promptFor(style, deps, repair) }], signal: controller.signal, outputSchema: CODE_SOURCE_SCHEMA, toolFilter: { allow: [] }, maxDepth: 1, agentOptions: { maxTokens: 24000 } })
      try {
        const source = checkedSource(await wait(run.result))
        if (source.rendererJs.trim() === style.baseRenderer.trim() || ONLY_REEXPORT.test(source.rendererJs)) throw Object.assign(new Error('Unchanged template renderer'), { code: 'INVALID_SOURCE' })
        if (!isCurrent()) throw Object.assign(new Error('Scene changed'), { code: 'STALE_GENERATION' })
        if (controller.signal.aborted) throw Object.assign(new Error('Generation aborted'), { code: 'GENERATION_ABORTED' })
        const ref = await wait(deps.create({ ownerSessionId: deps.ownerSessionId, scene: original.scene, experimentId: style.experimentId, childSessionId: String(run.id), source }))
        if (!isCurrent()) throw Object.assign(new Error('Scene changed'), { code: 'STALE_GENERATION' })
        append(ref)
        return ref
      } catch (error) {
        const code = codeOf(error)
        if (attempt === 0 && ['INVALID_SOURCE', 'INVALID_CODE_SOURCE', 'INVALID_PACKAGE', 'INVALID_METADATA', 'UNSAFE_RESOURCES'].includes(code) && !controller.signal.aborted && isCurrent()) { repair = code; continue }
        throw error
      } finally { await run.dispose() }
    }
    throw new Error('Code generation did not settle')
  } catch (error) {
    const code = codeOf(error)
    const failed: CodeVisualizationState = { status: 'failed', jobId, ...identity, code, message: code === 'GENERATION_TIMEOUT' ? '题目实验生成超时，可重新生成。' : code === 'GENERATION_ABORTED' ? '题目实验生成已停止，可重新生成。' : code === 'STALE_GENERATION' ? '题目场景已更新，本次生成已丢弃。' : '题目实验代码生成未完成，可重新生成。' }
    if (isCurrent()) append(failed)
    return failed
  } finally { clearTimeout(timer); deps.signal.removeEventListener('abort', onAbort) }
}
