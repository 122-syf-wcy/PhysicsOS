/**
 * Experiment report builder.
 *
 * Turns the CURRENT workspace frame into a structured, student-readable lab
 * report: name / goal / parameters / derived results / event timeline /
 * verification. Every line is read from {@link WorkspaceSnapshot} — the report
 * is a projection of already-verified runtime facts, never a recomputation.
 * The markdown rendering exists so a student can download and hand in the file.
 */

import type { WorkspaceSnapshot } from './workspace-runtime.ts'

export interface ReportRow {
  readonly label: string
  readonly value: string
}

export interface ExperimentReport {
  readonly title: string
  readonly goal: string
  readonly generatedAt: string
  readonly parameters: readonly ReportRow[]
  readonly derived: readonly ReportRow[]
  readonly events: readonly ReportRow[]
  readonly verification: readonly { label: string; status: string }[]
  /** One-line verdict derived from the verification outcome. */
  readonly conclusion: string
  readonly markdown: string
}

const formatValue = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  return absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)
    ? value.toExponential(2)
    : String(Math.round(value * 1e6) / 1e6)
}

/** Same adaptive clock the timeline uses: exponent form below 10 ms. */
const formatSeconds = (input: number): string => {
  if (!Number.isFinite(input) || input === 0) return '0.00 s'
  return Math.abs(input) < 0.01 ? `${input.toExponential(2)} s` : `${input.toFixed(2)} s`
}

const STATUS_TEXT: Record<string, string> = {
  passed: 'PASS',
  failed: 'FAIL',
  skipped: '—',
}

/** Build the report for the frame the student is looking at. */
export const buildExperimentReport = (
  snapshot: WorkspaceSnapshot,
  now = new Date(),
): ExperimentReport => {
  const parameters: ReportRow[] = snapshot.inspector.flatMap(section => [
    ...(section.parameters ?? []).map(parameter => ({
      label: `${parameter.label} ${parameter.symbol}`.trim(),
      value: `${formatValue(parameter.value)} ${parameter.unit}`.trim(),
    })),
    ...(section.choices ?? []).map(choice => ({
      label: choice.label,
      value: choice.options.find(option => option.value === choice.value)?.label ?? choice.value,
    })),
  ])

  const derived: ReportRow[] = snapshot.inspector.flatMap(section =>
    (section.derived ?? []).map(row => ({
      label: row.label,
      value: `${row.value} ${row.unit}`.trim(),
    })),
  )

  const events: ReportRow[] = snapshot.events.map(event => ({
    label: event.label,
    value: formatSeconds(event.time),
  }))

  const verification = snapshot.verification.map(check => ({
    label: check.label,
    status: STATUS_TEXT[check.status] ?? check.status,
  }))

  const failedCount = snapshot.verification.filter(check => check.status === 'failed').length
  const conclusion =
    snapshot.status === 'verified' && failedCount === 0
      ? '全部物理验证通过：本实验的仿真结果与所依据的物理规律一致。'
      : failedCount > 0
        ? `有 ${failedCount} 项检查未通过（含装置条件读数）：请对照验证清单分析原因 —— 例如速度选择条件不成立时，粒子偏转本身是正确物理。`
        : '仿真带有警告，结论以验证清单为准。'

  const title = snapshot.title
  const goal = snapshot.subtitle
  const generatedAt = now.toISOString()

  const markdownRows = (rows: readonly ReportRow[]): string =>
    rows.map(row => `| ${row.label} | ${row.value} |`).join('\n')

  const markdown = [
    `# 实验报告：${title}`,
    '',
    `> 生成时间：${generatedAt}`,
    `> 场景修订：r${snapshot.sceneRevision} · 播放时刻：${formatSeconds(snapshot.clock.time)} / ${formatSeconds(snapshot.clock.total)}`,
    '',
    '## 实验目标',
    '',
    goal,
    '',
    '## 实验参数',
    '',
    '| 参数 | 数值 |',
    '|---|---|',
    markdownRows(parameters),
    '',
    '## 引擎派生量',
    '',
    '| 物理量 | 数值 |',
    '|---|---|',
    markdownRows(derived),
    '',
    ...(events.length === 0
      ? []
      : ['## 实验过程（区域事件）', '', '| 事件 | 时刻 |', '|---|---|', markdownRows(events), '']),
    '## 物理验证',
    '',
    '| 检查 | 结果 |',
    '|---|---|',
    verification.map(check => `| ${check.label} | ${check.status} |`).join('\n'),
    '',
    '## 实验结论',
    '',
    conclusion,
    '',
    '（本报告由 PhysicsOS 从已验证的仿真结果生成，数值来自 Runtime，未经人工改写。）',
  ].join('\n')

  return { title, goal, generatedAt, parameters, derived, events, verification, conclusion, markdown }
}
