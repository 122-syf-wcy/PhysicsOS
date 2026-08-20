import { ChevronDown, Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface SceneTreeItemData {
  id: string
  label: string
  meta?: string
  icon?: ReactNode
  visible?: boolean
  locked?: boolean
  children?: readonly SceneTreeItemData[]
}

export function SceneTreeItem({
  item,
  selectedId,
  onSelect,
  depth = 0,
}: {
  item: SceneTreeItemData
  selectedId?: string
  onSelect?: (id: string) => void
  depth?: number
}) {
  const selected = item.id === selectedId
  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[12px]',
          selected ? 'bg-[var(--bg-selected)] text-[var(--primary-700)]' : 'hover:bg-[var(--bg-hover)]',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect?.(item.id)}
      >
        {item.children ? (
          <ChevronDown size={12} className="shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <span className="w-3" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
        {item.visible === false ? (
          <EyeOff size={12} className="text-[var(--text-tertiary)]" />
        ) : (
          <Eye size={12} className="text-[var(--text-tertiary)]" />
        )}
        {item.locked ? (
          <Lock size={12} className="text-[var(--text-tertiary)]" />
        ) : (
          <Unlock size={12} className="text-[var(--text-disabled)]" />
        )}
      </button>
      {item.meta ? (
        <p className="truncate pl-8 text-[11px] text-[var(--text-tertiary)]">{item.meta}</p>
      ) : null}
      {item.children?.map((child) => (
        <SceneTreeItem
          key={child.id}
          item={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

export function SceneTree({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly SceneTreeItemData[]
  selectedId?: string
  onSelect?: (id: string) => void
}) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <SceneTreeItem key={item.id} item={item} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}
