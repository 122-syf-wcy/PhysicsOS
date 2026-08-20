import {
  DataMetric,
  Formula,
  InspectorField,
  ObservableItem,
  PhysicsButton,
  PhysicsCanvasFrame,
  PhysicsPanel,
  PhysicsTabs,
  QuantityInput,
  SceneTree,
  StatusBadge,
  Timeline,
  ToolbarIconButton,
} from '@physicsos/ui'
import { FilePlus, FolderOpen, Pause, Play, RotateCcw, Save, Share2 } from 'lucide-react'
import { useState } from 'react'
import { MagneticCanvasVisual } from '../canvas/magnetic-canvas-visual.tsx'
import {
  agentTips,
  chartSeries,
  dataTableRows,
  layerToggles,
  liveMetrics,
  magneticSceneMeta,
  observables,
  particleInspector,
  sceneTreeFixture,
  timelineFixture,
} from '../fixtures/prototype/magnetic-scene.ts'

export function PhysicsWorkspacePage() {
  const [tab, setTab] = useState('props')
  const [selectedId, setSelectedId] = useState('particle')

  return (
    <main className="flex h-[calc(100vh-62px)] flex-col gap-3 overflow-hidden px-4 py-3 xl:px-5">
      <header className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-semibold">{magneticSceneMeta.title}</h1>
            <StatusBadge tone="saved">已保存</StatusBadge>
          </div>
          <p className="text-[12px] text-[var(--text-tertiary)]">{magneticSceneMeta.subtitle}</p>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarIconButton label="新建">
            <FilePlus size={14} />
          </ToolbarIconButton>
          <ToolbarIconButton label="打开">
            <FolderOpen size={14} />
          </ToolbarIconButton>
          <ToolbarIconButton label="保存">
            <Save size={14} />
          </ToolbarIconButton>
          <ToolbarIconButton label="分享">
            <Share2 size={14} />
          </ToolbarIconButton>
          <PhysicsButton size="sm" icon={<Play size={13} />}>
            运行
          </PhysicsButton>
          <PhysicsButton size="sm" variant="secondary" icon={<Pause size={13} />}>
            暂停
          </PhysicsButton>
          <PhysicsButton size="sm" variant="ghost" icon={<RotateCcw size={13} />}>
            重置
          </PhysicsButton>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[250px_minmax(0,1fr)_275px_270px] 2xl:grid-cols-[250px_minmax(0,1fr)_275px_270px_280px]">
        <PhysicsPanel title="场景与对象" extra={<span className="text-[11px] text-[var(--text-tertiary)]">图层</span>}>
          <SceneTree items={sceneTreeFixture} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="mt-4 space-y-2 border-t border-[var(--border-soft)] pt-3">
            <p className="text-[12px] font-semibold">图层控制</p>
            {layerToggles.map((layer) => (
              <label key={layer.id} className="flex items-center justify-between text-[12px]">
                <span>{layer.label}</span>
                <input type="checkbox" defaultChecked={layer.on} className="accent-[var(--primary-500)]" />
              </label>
            ))}
          </div>
        </PhysicsPanel>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <PhysicsCanvasFrame
            toolbar={
              <>
                <span className="text-[12px] text-[var(--text-secondary)]">2D 工作区 · 磁场 × 纸面向里</span>
                <span className="text-[11px] text-[var(--text-tertiary)]">网格 1 cm</span>
              </>
            }
          >
            <MagneticCanvasVisual />
          </PhysicsCanvasFrame>
          <Timeline
            currentLabel={timelineFixture.currentLabel}
            totalLabel={timelineFixture.totalLabel}
            progress={timelineFixture.progress}
          />
        </div>

        <PhysicsPanel title="检查器" padded={false}>
          <PhysicsTabs
            items={[
              { id: 'props', label: '属性' },
              { id: 'obs', label: '可观察量' },
              { id: 'data', label: '数据' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="p-3">
            {tab === 'props' ? (
              <>
                <p className="mb-1 text-[12px] font-semibold">粒子属性</p>
                <InspectorField label={<Formula tex="q" />}>
                  <QuantityInput defaultValue={particleInspector.charge} unit="C" />
                </InspectorField>
                <InspectorField label={<Formula tex="m" />}>
                  <QuantityInput defaultValue={particleInspector.mass} unit="kg" />
                </InspectorField>
                <p className="mb-1 mt-3 text-[12px] font-semibold">初始条件</p>
                <InspectorField label={<Formula tex="v_0" />}>
                  <QuantityInput defaultValue={particleInspector.speed} unit="m/s" />
                </InspectorField>
                <p className="mb-1 mt-3 text-[12px] font-semibold">磁场设置</p>
                <InspectorField label={<Formula tex="B" />}>
                  <QuantityInput defaultValue={particleInspector.b} unit="T" />
                </InspectorField>
              </>
            ) : null}
            {tab === 'obs' ? (
              <div>
                {observables.map((item) => (
                  <ObservableItem key={item.id} {...item} />
                ))}
              </div>
            ) : null}
            {tab === 'data' ? (
              <div className="grid grid-cols-2 gap-2">
                {liveMetrics.map((item) => (
                  <DataMetric key={item.label} {...item} />
                ))}
              </div>
            ) : null}
          </div>
        </PhysicsPanel>

        <div className="flex min-h-0 flex-col gap-3">
          <PhysicsPanel title="可观察量">
            {observables.map((item) => (
              <ObservableItem key={item.id} {...item} />
            ))}
          </PhysicsPanel>
          <PhysicsPanel title="实时数据">
            <div className="grid grid-cols-2 gap-2">
              {liveMetrics.map((item) => (
                <DataMetric key={item.label} {...item} />
              ))}
            </div>
          </PhysicsPanel>
          <PhysicsPanel title="AI 助手" className="min-h-0 2xl:hidden">
            <p className="text-[12px] text-[var(--text-secondary)]">{agentTips.status}</p>
            <div className="mt-2 rounded-[var(--radius-lg)] bg-[var(--primary-50)] px-3 py-2">
              <Formula tex={agentTips.formula} display />
            </div>
          </PhysicsPanel>
        </div>

        <PhysicsPanel title="AI 助手" className="hidden min-h-0 2xl:flex">
          <p className="text-[12px] text-[var(--text-secondary)]">{agentTips.status}</p>
          <div className="mt-3 rounded-[var(--radius-lg)] bg-[var(--primary-50)] px-3 py-2">
            <Formula tex={agentTips.formula} display />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-[12px] text-[var(--text-secondary)]">
            {agentTips.suggestions.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
          <div className="mt-auto flex gap-2 pt-4">
            <input
              className="h-9 flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-[12px]"
              placeholder="向我提问或输入命令…"
            />
            <PhysicsButton size="sm">发送</PhysicsButton>
          </div>
        </PhysicsPanel>
      </div>

      <section className="hidden h-[240px] grid-cols-[1.4fr_0.9fr] gap-3 xl:grid">
        <div className="grid grid-cols-3 gap-3">
          {(['velocity', 'force', 'radius'] as const).map((key) => (
            <article key={key} className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-3">
              <p className="text-[12px] text-[var(--text-secondary)]">
                {key === 'velocity' ? '|v| - t' : key === 'force' ? '|F| - t' : 'R - t'}
              </p>
              <svg viewBox="0 0 160 80" className="mt-2 h-24 w-full">
                <polyline
                  fill="none"
                  stroke="var(--primary-500)"
                  strokeWidth="2"
                  points={chartSeries[key]
                    .map((value, index) => `${12 + index * 20},${70 - value * (key === 'radius' ? 8 : 12)}`)
                    .join(' ')}
                />
              </svg>
            </article>
          ))}
        </div>
        <article className="overflow-auto rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-3">
          <p className="text-[12px] font-semibold">数据表（每 10 步）</p>
          <table className="mt-2 w-full text-left text-[11px] tabular-nums">
            <thead className="text-[var(--text-tertiary)]">
              <tr>
                <th>Step</th>
                <th>t / s</th>
                <th>θ / °</th>
                <th>|v|</th>
                <th>|F|</th>
                <th>R / cm</th>
              </tr>
            </thead>
            <tbody>
              {dataTableRows.map((row) => (
                <tr key={row.step} className="border-t border-[var(--border-soft)]">
                  <td>{row.step}</td>
                  <td>{row.t}</td>
                  <td>{row.theta}</td>
                  <td>{row.v}</td>
                  <td>{row.F}</td>
                  <td>{row.R}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </main>
  )
}
