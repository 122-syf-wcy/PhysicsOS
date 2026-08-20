import {
  DataMetric,
  InspectorField,
  ObservableItem,
  PhysicsButton,
  PhysicsCanvasFrame,
  PhysicsMark,
  PhysicsPanel,
  QuantityInput,
  StatusBadge,
  Timeline,
} from '@physicsos/ui'
import { FlaskConical, Folder, Home, Settings } from 'lucide-react'
import { MagneticCanvasVisual } from '../canvas/magnetic-canvas-visual.tsx'
import { liveMetrics, observables, particleInspector, timelineFixture } from '../fixtures/prototype/magnetic-scene.ts'

const sideItems = [
  { icon: Home, label: '首页' },
  { icon: FlaskConical, label: '物理实验室' },
  { icon: Folder, label: '试题空间' },
  { icon: Settings, label: '设置' },
]

export function DesktopWorkspacePage() {
  return (
    <div className="flex h-screen flex-col bg-[var(--bg-app)]">
      <header className="flex h-9 items-center justify-between border-b border-[var(--border-soft)] bg-white px-3">
        <div className="flex items-center gap-2">
          <PhysicsMark size={18} />
          <span className="text-[12px] font-medium">PhysicsOS</span>
        </div>
        <div className="flex gap-2 text-[11px] text-[var(--text-tertiary)]">
          <span>—</span>
          <span>□</span>
          <span>×</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[210px] flex-col border-r border-[var(--border-soft)] bg-white px-3 py-4">
          <nav className="space-y-1">
            {sideItems.map((item, index) => (
              <button
                key={item.label}
                type="button"
                className={`flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-[13px] ${
                  index === 1 ? 'bg-[var(--bg-selected)] text-[var(--primary-700)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-[var(--radius-lg)] bg-[var(--bg-subtle)] p-3 text-[11px]">
            <p>云空间 28.6 GB / 100 GB</p>
            <div className="mt-2 h-1.5 rounded-full bg-white">
              <div className="h-full w-[28%] rounded-full bg-[var(--primary-500)]" />
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[50px] items-center justify-between border-b border-[var(--border-soft)] bg-white px-4">
            <p className="text-[14px] font-semibold">带电粒子在匀强磁场中运动</p>
            <div className="flex gap-2">
              <PhysicsButton size="sm">运行</PhysicsButton>
              <PhysicsButton size="sm" variant="secondary">
                暂停
              </PhysicsButton>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_320px] gap-3 p-3">
            <PhysicsPanel title="对象树">
              <p className="text-[12px]">Scene / Particles / Observers</p>
              {observables.slice(0, 4).map((item) => (
                <ObservableItem key={item.id} {...item} />
              ))}
            </PhysicsPanel>
            <div className="flex min-h-0 flex-col gap-3">
              <PhysicsCanvasFrame>
                <MagneticCanvasVisual />
              </PhysicsCanvasFrame>
              <div className="grid h-[180px] grid-cols-2 gap-3">
                <article className="rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white p-3">
                  <p className="text-[12px]">数据表</p>
                  <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">t, x, y, z, vx, vy, vz</p>
                </article>
                <div className="grid grid-cols-2 gap-2">
                  {liveMetrics.slice(0, 4).map((item) => (
                    <DataMetric key={item.label} {...item} />
                  ))}
                </div>
              </div>
            </div>
            <PhysicsPanel title="参数">
              <InspectorField label="q">
                <QuantityInput defaultValue={particleInspector.charge} unit="C" />
              </InspectorField>
              <InspectorField label="m">
                <QuantityInput defaultValue={particleInspector.mass} unit="kg" />
              </InspectorField>
              <InspectorField label="B">
                <QuantityInput defaultValue={particleInspector.b} unit="T" />
              </InspectorField>
              <StatusBadge tone="saved">物理约束检查通过</StatusBadge>
            </PhysicsPanel>
          </div>
          <footer className="flex h-10 items-center justify-between border-t border-[var(--border-soft)] bg-white px-4 text-[11px] text-[var(--text-secondary)]">
            <Timeline
              className="h-8 flex-1 border-0 shadow-none"
              currentLabel={timelineFixture.currentLabel}
              totalLabel={timelineFixture.totalLabel}
              progress={timelineFixture.progress}
            />
            <span className="ml-4">Δt 1.00e-6 s · Engine PHYS-2024.2</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
