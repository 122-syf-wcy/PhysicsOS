import { PhysicsPanel } from '@physicsos/ui'

export function PlaceholderPage({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-[1280px] px-8 py-10">
      <PhysicsPanel title={title}>
        <p className="text-sm text-[var(--text-secondary)]">{detail}</p>
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          PHASE-01 仅提供路由与壳层，不编造业务实现。
        </p>
      </PhysicsPanel>
    </main>
  )
}
