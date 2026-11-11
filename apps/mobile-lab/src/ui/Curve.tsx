import { useId, useMemo, useState } from 'react'
import type { ChartSeries } from '@lab/physics/scene-visual-model.ts'
import type { LabClient } from '../runtime/client.ts'

const value = (number: number): string => Number.isFinite(number) ? Number(number.toPrecision(6)).toString() : '未定义'
/** One physical quantity per axis: never put unlike units on a fabricated second scale. */
export function Curve({ chart, client }: { chart: ChartSeries; client: LabClient }) {
  const titleId = useId()
  const [selected, setSelected] = useState<number | undefined>()
  const [page, setPage] = useState<{ points: ChartSeries['points']; start: number; total: number }>()
  const [error, setError] = useState('')
  const geometry = useMemo(() => {
    const points = chart.points.filter(point => Number.isFinite(point.t) && Number.isFinite(point.value))
    const xs = points.map(point => point.t), ys = points.map(point => point.value)
    let loX = Math.min(...xs), hiX = Math.max(...xs), loY = Math.min(...ys), hiY = Math.max(...ys)
    if (!points.length) { loX = loY = 0; hiX = hiY = 1 }
    if (loX === hiX) hiX = loX + 1
    if (loY === hiY) { const padding = Math.max(1, Math.abs(loY) * 0.05); loY -= padding; hiY += padding }
    const x = (t: number) => 58 + (t - loX) / (hiX - loX) * 500
    const y = (v: number) => 196 - (v - loY) / (hiY - loY) * 166
    return { points, loX, hiX, loY, hiY, x, y, path: points.map((point, index) => `${index ? 'L' : 'M'}${x(point.t)} ${y(point.value)}`).join(' ') }
  }, [chart])
  const point = selected === undefined ? undefined : geometry.points[Math.min(selected, geometry.points.length - 1)]
  const table = async (start: number) => {
    try { setPage(await client.query('chart', { id: chart.id, start })); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : '曲线读数未能加载。') }
  }
  return <figure className="curve viz-root" aria-labelledby={titleId}>
    <figcaption id={titleId}>{chart.title}</figcaption>
    <svg className="curve-plot" viewBox="0 0 620 250" role="img" aria-label={`${chart.title}，${chart.xLabel}，${chart.yLabel}。左右方向键读取显示采样，表格可查询全部权威读数。`}
      tabIndex={0} onFocus={() => setSelected(0)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        setSelected(event.key === 'Home' ? 0 : event.key === 'End' ? geometry.points.length - 1 : Math.max(0, Math.min(geometry.points.length - 1, (selected ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))))
      }} onPointerMove={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const t = geometry.loX + ((event.clientX - bounds.left) * 620 / bounds.width - 58) / 500 * (geometry.hiX - geometry.loX)
        let best = 0
        geometry.points.forEach((point, index) => { if (Math.abs(point.t - t) < Math.abs(geometry.points[best]!.t - t)) best = index })
        setSelected(best)
      }} onPointerLeave={() => setSelected(undefined)}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}>
        <path d={`M58 ${196 - 166 * fraction} H558`} className="curve-grid" />
        <text x="51" y={200 - 166 * fraction} textAnchor="end">{value(geometry.loY + (geometry.hiY - geometry.loY) * fraction)}</text>
      </g>)}
      <path d="M58 30 V196 H558" className="curve-axis" />
      <text x="58" y="218">{value(geometry.loX)}</text><text x="558" y="218" textAnchor="end">{value(geometry.hiX)}</text>
      <text x="308" y="240" textAnchor="middle">{chart.xLabel}</text><text x="58" y="17">{chart.yLabel}</text>
      <path d={geometry.path} className="curve-line" />
      {geometry.points.length ? <circle cx={geometry.x(geometry.points.at(-1)!.t)} cy={geometry.y(geometry.points.at(-1)!.value)} r="4" className="curve-dot" /> : null}
      {point ? <g><path d={`M${geometry.x(point.t)} 30 V196`} className="curve-crosshair" /><circle cx={geometry.x(point.t)} cy={geometry.y(point.value)} r="4" className="curve-dot" /></g> : null}
    </svg>
    <div className="curve-reading" aria-live="polite">{point ? <><strong>{value(point.value)}</strong> {chart.yLabel} · {value(point.t)} {chart.xLabel}</> : `${geometry.points.length} 个显示采样；查看表格获取未降采样数据。`}</div>
    <details onToggle={event => { if (event.currentTarget.open && page === undefined) void table(0) }}><summary>完整曲线数据表</summary>
      {error && <p role="alert">{error}</p>}
      {page && <><div className="table-scroll"><table><caption>{chart.title}，原始点 {page.start + 1}–{Math.min(page.total, page.start + page.points.length)} / {page.total}</caption><thead><tr><th>{chart.xLabel}</th><th>{chart.yLabel}</th></tr></thead><tbody>{page.points.map((point, index) => <tr key={index}><td>{value(point.t)}</td><td>{value(point.value)}</td></tr>)}</tbody></table></div>
        <div className="button-row"><button disabled={page.start === 0} onClick={() => void table(Math.max(0, page.start - 200))}>上一页</button><button disabled={page.start + page.points.length >= page.total} onClick={() => void table(page.start + 200)}>下一页</button></div></>}
    </details>
  </figure>
}
