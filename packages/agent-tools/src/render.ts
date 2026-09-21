/**
 * Model-facing text projections of the PhysicsOS tool results.
 *
 * The canonical value each tool returns is the runtime's JSON; what the model
 * reads is the text below, and every harness binding renders the same text so
 * the model experience does not depend on the runtime it is mounted in. It is
 * written to be quoted to a student: every number carries its unit, every
 * verification check its verdict, and nothing is rounded further than four
 * significant figures so the model cannot lose the distinction between
 * 0.0418 m and 0.042 m.
 */

import type {
  CommandResult,
  ExperimentListing,
  ObserveResult,
  SceneDescription,
  SimulateResult,
  SolveQuestionResult,
  ToolScalar,
  ToolVerification,
} from './physics-tool-runtime.ts'
import type { PhysicsToolName } from './tool-docs.ts'

/** Four significant figures; scientific notation outside the comfortable decimal range. */
export const fmt = (value: number | null): string => {
  if (value === null) return 'n/a'
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(3).replace(/\.?0+e/, 'e')
  const digits = Math.max(0, 3 - Math.floor(Math.log10(magnitude)))
  return Number(value.toFixed(digits)).toString()
}

const scalarLine = (scalar: ToolScalar): string =>
  `- ${scalar.key} = ${fmt(scalar.value)}${scalar.unit === '' ? '' : ` ${scalar.unit}`}`
  + (scalar.formula === undefined ? '' : `（${scalar.formula}）`)
  + (scalar.targetId === undefined ? '' : ` @${scalar.targetId}`)

const verificationLines = (verification: ToolVerification): string[] => {
  const passed = verification.checks.filter((check) => check.passed).length
  const lines = [`校验：${verification.status}（${passed}/${verification.checks.length} 项通过）`]
  for (const check of verification.checks) {
    if (!check.passed) lines.push(`  ✗ ${check.id}${check.message === undefined ? '' : `：${check.message}`}`)
  }
  for (const error of verification.errors) lines.push(`  ! ${error}`)
  return lines
}

export const renderExperiments = (listing: readonly ExperimentListing[]): string => {
  const byDomain = new Map<string, ExperimentListing[]>()
  for (const entry of listing) {
    const bucket = byDomain.get(entry.domain) ?? []
    bucket.push(entry)
    byDomain.set(entry.domain, bucket)
  }
  const lines = [`共 ${listing.length} 个实验：`]
  for (const [domain, entries] of byDomain) {
    lines.push(`[${domain}]`)
    for (const entry of entries) {
      lines.push(`- ${entry.id}（${entry.stage === 'junior' ? '初中' : '高中'}）${entry.title}：${entry.description}`)
    }
  }
  return lines.join('\n')
}

export const renderScene = (scene: SceneDescription): string => {
  const lines = [
    `场景 ${scene.sceneId} · 修订 ${scene.revision} · ${scene.title}`,
    `领域 ${scene.domain} · 引擎 ${scene.engineId}`
    + (scene.sourceQuestionId === undefined ? '' : ` · 来源题目 ${scene.sourceQuestionId}`),
  ]
  if (scene.description !== undefined) lines.push(scene.description)
  lines.push(
    `时间轴：${fmt(scene.timeline.start)} s → ${scene.timeline.end === null ? '由引擎决定' : `${fmt(scene.timeline.end)} s`}`,
  )
  lines.push('对象：')
  for (const object of scene.objects) {
    lines.push(`- ${object.id} [${object.kind}]${object.name === undefined ? '' : ` ${object.name}`}`)
  }
  if (scene.observables.length > 0) {
    lines.push(
      '可观察量：' + scene.observables.map((item) => `${item.id}(${item.type}${item.visible ? '' : '，隐藏'})`).join('、'),
    )
  }
  lines.push('可用命令：' + scene.commands.join('、'))
  return lines.join('\n')
}

export const renderSolve = (result: SolveQuestionResult): string => {
  const lines: string[] = []
  if (result.status === 'rejected') {
    lines.push(`未能求解（${result.workflowState}）。`)
    if (result.domain !== undefined) lines.push(`识别到的领域 / 模型：${result.domain} / ${result.model ?? '?'}`)
    if (result.knowns.length > 0) {
      lines.push('读到的已知量：' + result.knowns.map((known) => `${known.symbol} = ${fmt(known.value)} ${known.unit}`).join('，'))
    }
    if (result.targets.length > 0) lines.push('读到的待求量：' + result.targets.join('、'))
    lines.push('原因：')
    for (const issue of result.issues) lines.push(`- [${issue.severity}] ${issue.code}：${issue.message}`)
    lines.push('请不要自行估算答案；向学生说明题面哪里需要补全或改写。')
    return lines.join('\n')
  }
  lines.push(
    `已求解（${result.domain ?? '?'} / ${result.model ?? '?'}）`
    + (result.goldenQuestionId === undefined ? '' : ` · 题库题 ${result.goldenQuestionId}`),
  )
  if (result.knowns.length > 0) {
    lines.push('已知：' + result.knowns.map((known) => `${known.label} ${known.symbol} = ${fmt(known.value)} ${known.unit}`).join('，'))
  }
  lines.push('待求：' + (result.targets.length === 0 ? '（题面未指明）' : result.targets.join('、')))
  lines.push('答案：')
  for (const answer of result.answers) {
    lines.push(`- ${answer.label}${answer.symbol === '' ? '' : ` ${answer.symbol}`} = ${answer.value}${answer.unit === '' ? '' : ` ${answer.unit}`}`)
  }
  lines.push('步骤：')
  for (const step of result.steps) {
    lines.push(`${step.index}. ${step.title}${step.description === '' ? '' : ` — ${step.description}`}`)
    if (step.substitution !== undefined) lines.push(`   代入：${step.substitution}`)
    if (step.result !== undefined) lines.push(`   结果：${step.result}`)
  }
  if (result.verification !== undefined) lines.push(...verificationLines(result.verification))
  for (const issue of result.issues) lines.push(`- [${issue.severity}] ${issue.code}：${issue.message}`)
  if (result.scene !== undefined) {
    lines.push(
      result.reusedScene === true
        ? `题面与之前相同：复用已有场景 ${result.scene.sceneId}（修订 ${result.scene.revision}），没有新建场景。`
        : `场景已就绪：sceneId = ${result.scene.sceneId}（修订 ${result.scene.revision}，引擎 ${result.scene.engineId}）。`,
    )
    lines.push('对象：' + result.scene.objects.map((object) => `${object.id}[${object.kind}]`).join('、'))
    lines.push('告诉学生：左侧"最近空间"里打开该场景即可看动画（点"运行"播放运动过程）。')
  }
  return lines.join('\n')
}

export const renderCommand = (result: CommandResult): string =>
  result.ok
    ? `已执行：场景 ${result.sceneId} 现在是修订 ${result.revision}${result.eventType === undefined ? '' : `（事件 ${result.eventType}）`}。调用 physics_simulate 获取新结果。`
    : `已拒绝（${result.error?.code ?? 'UNKNOWN'}）：${result.error?.message ?? ''} 场景保持修订 ${result.revision} 不变。`

export const renderSimulate = (result: SimulateResult): string => {
  const lines = [
    `模拟完成：场景 ${result.sceneId} 修订 ${result.revision} · 引擎 ${result.engineId}（${result.domain}）`,
    `采样 ${result.sampleCount} 个状态，t = ${fmt(result.startTime)} s → ${fmt(result.endTime)} s`,
    ...verificationLines(result.verification),
  ]
  lines.push('导出量：')
  for (const scalar of result.derived) lines.push(scalarLine(scalar))
  if (result.events.length > 0) {
    lines.push('事件：')
    for (const event of result.events) {
      lines.push(`- ${event.kind}${event.time === null ? '' : ` @ t = ${fmt(event.time)} s`}${event.targetId === undefined ? '' : ` (${event.targetId})`}`)
    }
  }
  return lines.join('\n')
}

export const renderObserve = (result: ObserveResult): string => {
  const lines = [`场景 ${result.sceneId} 修订 ${result.revision} 在 t = ${fmt(result.time)} s 的状态：`]
  for (const object of result.objects) {
    const parts: string[] = []
    if (object.position !== undefined) {
      parts.push(`位置 (${fmt(object.position.x)}, ${fmt(object.position.y)}${object.position.z ? `, ${fmt(object.position.z)}` : ''}) ${object.position.unit}`)
    }
    if (object.velocity !== undefined) {
      parts.push(`速度 (${fmt(object.velocity.x)}, ${fmt(object.velocity.y)}${object.velocity.z ? `, ${fmt(object.velocity.z)}` : ''}) ${object.velocity.unit}`)
    }
    for (const value of object.values) parts.push(`${value.key} = ${fmt(value.value)}${value.unit === '' ? '' : ` ${value.unit}`}`)
    lines.push(`- ${object.id}：${parts.length === 0 ? '（无数值）' : parts.join('；')}`)
  }
  if (result.derived.length > 0) {
    lines.push('导出量：')
    for (const scalar of result.derived) lines.push(scalarLine(scalar))
  }
  return lines.join('\n')
}

/**
 * Renderer per tool name, so a harness binding can wire its `render` hook
 * generically: `PHYSICS_TOOL_RENDERERS[name](value)`. Each accepts the canonical
 * JSON the matching runtime method returned.
 */
export const PHYSICS_TOOL_RENDERERS: Readonly<Record<PhysicsToolName, (value: unknown) => string>> = {
  physics_list_experiments: (value) => renderExperiments(value as readonly ExperimentListing[]),
  physics_create_experiment: (value) => renderScene(value as SceneDescription),
  physics_solve_question: (value) => renderSolve(value as SolveQuestionResult),
  physics_describe_scene: (value) => renderScene(value as SceneDescription),
  physics_scene_command: (value) => renderCommand(value as CommandResult),
  physics_simulate: (value) => renderSimulate(value as SimulateResult),
  physics_observe: (value) => renderObserve(value as ObserveResult),
}
