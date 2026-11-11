import { useCallback, useState } from 'react'
import { LensBench2D } from '@lab/client/experiments/LensBench2D.tsx'
import { lensParameter, lensReading } from '@lab/client/experiments/lens-bench.ts'
import { NOTEBOOK_LIMIT } from '@lab/client/experiments/experiment-notebook.ts'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { LabClient } from '../runtime/client.ts'
import type { WireSummary } from '../runtime/transport.ts'
import { LabError } from '../shared/protocol.ts'

import { LENS_PRESETS, lensPresetDistance } from './lens-lesson.ts'

export function LensStage({ frame, client }: { frame: WorkspaceFrame; client: LabClient }) {
  const preview = useCallback((id: string, value: number) => { void client.action('previewParameter', id, value).catch(() => undefined) }, [client])
  const commit = useCallback((id: string, value: number) => { void client.action('commitParameter', id, value).catch(() => undefined) }, [client])
  const cancel = useCallback(() => { void client.action('cancelParameterPreview').catch(() => undefined) }, [client])
  const screenLit = frame.view.opticalScreens?.[0]?.lit === true
  const noImage = !frame.view.opticalImages?.length
  const screenState = noImage ? '此时不成像，出射光平行' : screenLit ? '光屏已对焦'
    : frame.view.opticalImages?.[0]?.nature === 'virtual' ? '虚像不能用光屏承接' : '移动光屏寻找清晰像'
  return <div className="stage-wrap lens-stage" data-testid="lens-stage">
    <p className="lens-interaction-hint">拖动物体或光屏 · 方向键可精细调节</p>
    <div className="scene-host lens-host" data-testid="physics-scene" data-domain="optics" data-screen-lit={screenLit} style={{ color: 'var(--physics-canvas-text)' }}>
      <LensBench2D snapshot={frame} preview={preview} commit={commit} cancel={cancel} />
    </div>
    <div className="lens-reading" aria-label="当前成像结果" role="status"><span>{lensReading(frame, 'image-nature')}</span><span>{screenState}</span></div>
  </div>
}

export function LensLesson({ frame, client, summary }: { frame: WorkspaceFrame; client: LabClient; summary: WireSummary }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const f = lensParameter(frame, 'focal-length'), u = lensParameter(frame, 'object-distance')
  const task = async (operation: () => Promise<void>) => {
    setBusy(true); setProblem('')
    try { await operation() } catch (error) { if (!(error instanceof LabError) || error.code !== 'LOAD_REPLACED') setProblem('操作未完成，原有记录仍保留。请查看实验提示后重试。') }
    finally { setBusy(false) }
  }
  return <section className="lens-lesson" aria-label="凸透镜探究任务">
    <p className="muted">先移动物体，再移动光屏。记录不同物距下的像，用真实数据比较规律。</p>
    <div className="lens-presets" aria-label="典型成像条件">{LENS_PRESETS.map(preset => <button key={preset.id} data-testid={`lens-preset-${preset.id}`} disabled={busy}
      aria-pressed={Math.abs(u - f * preset.factor) <= 1e-8 * Math.max(1, Math.abs(u))}
      onClick={() => void task(() => client.action('commitParameter', 'object-distance', lensPresetDistance(client.frames.getSnapshot() ?? frame, preset.id)))}>
      <strong>{preset.label}</strong><span>{preset.condition}</span>
    </button>)}</div>
    <div className="lens-inquiry" aria-label="探究步骤"><ol>
      <li><strong>调整物距</strong><span>经过 2F 和 F 时，像的位置、大小怎样变化？</span></li>
      <li><strong>寻找清晰像</strong><span>拖动光屏。实像、虚像都能在屏上接到吗？</span></li>
      <li><strong>记录与比较</strong><span>保留多组条件与引擎读数，到数据面板比较。</span></li>
    </ol></div>
    <div className="button-row">
      <button disabled={busy || summary.previewing || frame.status === 'failed' || summary.notebook.length >= NOTEBOOK_LIMIT || frame.table.rows.length === 0} onClick={() => void task(() => client.action('recordObservation'))} data-testid="lens-record">记录当前条件</button>
      <button disabled={busy} onClick={() => setConfirmation(true)}>恢复初始装置</button>
    </div>
    {confirmation && <div className="lens-confirm" role="alertdialog" aria-label="恢复初始装置确认"><p>恢复原始装置条件？当前已记录的数据与编辑历史会保留，可撤销这次恢复。</p><div className="button-row">
      <button onClick={() => setConfirmation(false)}>取消</button>
      <button disabled={busy} onClick={() => { setConfirmation(false); void task(() => client.action('restoreOrigin')) }}>确认恢复装置</button>
    </div></div>}
    {summary.notebook.length >= NOTEBOOK_LIMIT && <p role="status">已记录 100 组，请先导出或删除不需要的记录。</p>}
    {problem && <p role="alert">{problem}</p>}
  </section>
}
