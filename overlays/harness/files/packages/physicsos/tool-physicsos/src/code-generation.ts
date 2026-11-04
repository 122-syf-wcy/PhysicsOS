/** Bounded parent-owned code generation. Durable parent events contain references only. */
import { randomUUID, createHash } from 'node:crypto'
import type { CodeExperimentRef, CodeVisualizationSource, CodeVisualizationState } from '@physicsos/agent-tools'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { PhysicsSceneSnapshot } from './types.ts'

export const CODE_TIMEOUT_MS = 300_000
export const CODE_SOURCE_SCHEMA: ObjectJsonSchema = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', description: 'Required nonempty title, at most 120 characters.' }, summary: { type: 'string', description: 'At most 1000 characters.' },
  rendererJs: { type: 'string', description: 'Self-contained renderFrame(snapshot) using native Canvas2D or SVG. No imports, old renderer or empty wrapper; at most 96000 characters.' }, stylesheet: { type: 'string', description: 'CSS for the independent experimental scene, at most 24000 characters.' },
}, required: ['title', 'summary', 'rendererJs', 'stylesheet'] }
export interface CodeStyleContext {
  experimentId: string
  developerPrompt: string
  publishedBody: string
  styleVersion: string
  renderContract: string
  allowedAssetPaths: string[]
}
export interface CodeGenerationDependencies {
  ownerSessionId: string
  snapshot: PhysicsSceneSnapshot
  signal: AbortSignal
  experimentId: string
  instructions?: string
  timeoutMs?: number
  context(experimentId: string): Promise<CodeStyleContext>
  start(request: Pick<
    SubagentStartRequest, 'prompt' | 'signal' | 'outputSchema' | 'maxDepth' | 'toolFilter' | 'label' | 'agentOptions'
  >): Promise<Pick<SubagentRun, 'id' | 'result' | 'dispose'>>
  create(input: {
    ownerSessionId: string
    scene: unknown
    experimentId: string
    childSessionId: string
    source: CodeVisualizationSource
  }): Promise<CodeExperimentRef>
  current(): PhysicsSceneSnapshot | undefined
  isCurrent?(): boolean
  publish(snapshot: PhysicsSceneSnapshot): void
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Unknown undefined/function/symbol values stringify to undefined.
    return JSON.stringify(value) ?? 'null'
  }
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
    '为下面的真实题目生成独立 Canvas 实验画面和完整的现代实验场景。只返回 title、summary、rendererJs、stylesheet 四个字符串。',
    '已有物理解答和校验已完成。本任务只设计与绘制，不再推导或重新解题。输出紧凑可工作的代码，renderer 建议不超过160行，CSS不超过100行，尽快用 structured_output 提交。',
    '使用题目的原始场景与平台 frame/snapshot；绝不改写题目条件、引入默认场景、重新计算物理答案或编造模拟结果。',
    'rendererJs 必须导出 renderFrame(snapshot)，在现有 #canvas DIV 内创建自己的 Canvas2D（推荐）或原生SVG并绘制。禁止任何 import/reexport、renderPlatformFrame、旧平台绘图函数或仅装饰旧图的包装器。平台只提供数据与握手，不提供本题画面。',
    '代码结构保持直接：在导出的 renderFrame 内读取 view 的对象/轨迹并实际绘图，或调用普通命名函数/const箭头函数完成坐标投影和绘制。不要使用对象/类方法或动态函数分派，也不要只返回view、把绘图留在未调用的函数里。复用Canvas/DOM，每次完成当前引擎帧的绘制后再返回；不要创建自己的物理计时循环。',
    '画面要有真实装置感和独立构图：精致材质、柔和空间光照、清晰物体与运动轨迹、玻璃信息卡和关键点标注。不要照画旧坐标纸/大XY网格图；辅助刻度可简洁呈现。让人一眼能看到本题的实验现象，标题取自然的题目实验名称。',
    '只用浏览器原生绘图/DOM/CSS。禁止 fetch、外网、存储、parent/top、eval、Function、动态import及脚本注入。禁止返回 HTML、manifest 或其他文件。',
    '所有数值取自平台 frame/场景已有的事实；显示的解答只引用下面已通过引擎校验的结果。代码中不得硬编码另一题的参数或使用模拟公式代替引擎。',
    '每次 renderFrame 使用当前 snapshot.view 的位置/轨迹/装置几何，snapshot.clock 的播放时间，inspector/overlay 中的真实量测；不能自己用 v*t 或加速度公式推进物体。改变屏幕坐标、材质、绘制大小和布局属于展示。向量端点已经按平台显示比例缩放，不得据箭头长度推算速度或力。',
    `实验风格目标：${style.experimentId}；发布风格版本：${style.styleVersion}`,
    `真实 V3 数据/绘制契约（字段准确，以此读取引擎事实）：\n${style.renderContract}`,
    `最新实验开发规范（只参考物理、参数与封闭资源契约，不采用其中旧renderer或外部构建建议）：\n${style.developerPrompt}`,
    `最新已发布的可编辑说明（参考视觉/教学正文；旧模板绑定和旧绘图调用建议不适用于独立画面）：\n${style.publishedBody}`,
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
  const onAbort = (): void => { controller.abort(deps.signal.reason) }
  deps.signal.addEventListener('abort', onAbort, { once: true })
  if (deps.signal.aborted) onAbort()
  const timeoutMs = deps.timeoutMs ?? CODE_TIMEOUT_MS
  const deadlineAt = Date.now() + timeoutMs
  const timer = setTimeout(() => {
    controller.abort(Object.assign(new Error('Code generation timed out'), { code: 'GENERATION_TIMEOUT' }))
  }, timeoutMs)
  const identity = { ownerSessionId: deps.ownerSessionId, sceneId: original.sceneId, sceneRevision: original.revision }
  const isCurrent = (): boolean => {
    const current = deps.current()
    return deps.isCurrent?.() !== false && current?.sceneId === original.sceneId && current.revision === original.revision
      && sceneHash(current.scene) === expectedHash && current.visualization?.status === 'generating' && current.visualization.jobId === jobId
  }
  const append = (visualization: CodeVisualizationState): void => { deps.publish({ ...original, visualization }) }
  append({ status: 'generating', jobId, deadlineAt, ...identity })
  let abortListener: (() => void) | undefined
  const wait = async <T>(work: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw Object.assign(new Error('Generation aborted'), { code: codeOf(controller.signal.reason) === 'GENERATION_TIMEOUT' ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED' })
    const aborted = new Promise<never>((_, reject) => {
      abortListener = () => {
        reject(Object.assign(new Error('Generation aborted'), {
          code: codeOf(controller.signal.reason) === 'GENERATION_TIMEOUT' ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED',
        }))
      }
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
      const run = await deps.start({ label: `题目实验代码 · ${original.title.slice(0, 100)}`, prompt: [{ type: 'text', text: promptFor(style, deps, repair) }], signal: controller.signal, outputSchema: CODE_SOURCE_SCHEMA, toolFilter: { allow: [] }, maxDepth: 1, agentOptions: { maxTokens: 8192 } })
      try {
        const source = checkedSource(await wait(run.result))
        if (ONLY_REEXPORT.test(source.rendererJs)) throw Object.assign(new Error('A renderer must draw the question independently'), { code: 'INVALID_SOURCE' })
        if (!isCurrent()) throw Object.assign(new Error('Scene changed'), { code: 'STALE_GENERATION' })
        if (controller.signal.aborted) throw Object.assign(new Error('Generation aborted'), { code: 'GENERATION_ABORTED' })
        const ref = await wait(deps.create({
          ownerSessionId: deps.ownerSessionId, scene: original.scene, experimentId: style.experimentId,
          childSessionId: String(run.id), source,
        }))
        if (ref.rendererKind !== 'independent') throw Object.assign(new Error('Host did not validate an independent renderer'), { code: 'INVALID_METADATA' })
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
