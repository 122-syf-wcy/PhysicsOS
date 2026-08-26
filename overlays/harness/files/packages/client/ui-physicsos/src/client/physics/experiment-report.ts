/**
 * Experiment report builder.
 *
 * Turns the CURRENT workspace frame into a structured, student-readable lab
 * report: name / goal / parameters / derived results / event timeline /
 * verification. Every line is read from {@link WorkspaceSnapshot} — the report
 * is a projection of already-verified runtime facts, never a recomputation.
 * The markdown rendering exists so a student can download and hand in the file;
 * {@link experimentReportPrintHtml} renders the same facts as a standalone
 * print-ready page (A4 styles inlined) for the 打印版 export.
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

/* ------------------------------------------------------------- print html -- */

const escapeHtml = (input: string): string =>
  input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const tableHtml = (
  heading: string,
  columns: readonly [string, string],
  rows: readonly ReportRow[],
): string =>
  rows.length === 0
    ? ''
    : [
      `<h2>${escapeHtml(heading)}</h2>`,
      '<table>',
      `<thead><tr><th>${escapeHtml(columns[0])}</th><th>${escapeHtml(columns[1])}</th></tr></thead>`,
      '<tbody>',
      ...rows.map(
        row =>
          `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`,
      ),
      '</tbody>',
      '</table>',
    ].join('\n')

/**
 * The report as a self-contained printable HTML document (styles inlined, no
 * external assets), so 打印版导出 works offline and survives being saved as a
 * file. Same facts as the panel and the Markdown download — never recomputed.
 */
export const experimentReportPrintHtml = (report: ExperimentReport): string => {
  const checks = report.verification
    .map(
      check =>
        `<tr><td>${escapeHtml(check.label)}</td><td class="status" data-status="${escapeHtml(check.status)}">${escapeHtml(check.status)}</td></tr>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.title)} · 实验报告</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1c2733; margin: 0; font-size: 12px; line-height: 1.6;
  }
  header { border-bottom: 2px solid #1c2733; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #5a6b7c; font-size: 11px; }
  .goal { margin: 10px 0 16px; padding: 8px 12px; background: #f4f7fa; border-left: 3px solid #3b82c4; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #cfd8e0; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
  th, td { border: 1px solid #cfd8e0; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #eef2f6; font-weight: 600; }
  td.status { width: 64px; text-align: center; font-weight: 600; }
  td.status[data-status="PASS"] { color: #1a7f4b; }
  td.status[data-status="FAIL"] { color: #c02f2f; }
  .conclusion { margin: 8px 0 16px; padding: 8px 12px; background: #f4f7fa; border-left: 3px solid #1a7f4b; }
  footer { margin-top: 20px; color: #8a97a5; font-size: 10px; border-top: 1px solid #cfd8e0; padding-top: 6px; }
  .signature { margin-top: 26px; display: flex; gap: 40px; color: #5a6b7c; }
  .signature span { flex: 1; border-top: 1px solid #8a97a5; padding-top: 4px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>实验报告：${escapeHtml(report.title)}</h1>
  <p class="meta">生成时间：${escapeHtml(report.generatedAt)} · 由 PhysicsOS 从已验证的仿真结果生成</p>
</header>
<p class="goal"><strong>实验目标</strong>　${escapeHtml(report.goal)}</p>
${tableHtml('实验参数', ['参数', '数值'], report.parameters)}
${tableHtml('引擎派生量', ['物理量', '数值'], report.derived)}
${tableHtml('实验过程（区域事件）', ['事件', '时刻'], report.events)}
<h2>物理验证</h2>
<table>
<thead><tr><th>检查</th><th>结果</th></tr></thead>
<tbody>
${checks}
</tbody>
</table>
<h2>实验结论</h2>
<p class="conclusion">${escapeHtml(report.conclusion)}</p>
<div class="signature">
  <span>实验人</span>
  <span>日期</span>
  <span>教师签字</span>
</div>
<footer>本报告数值来自 PhysicsOS Runtime，未经人工改写。</footer>
</body>
</html>`
}
