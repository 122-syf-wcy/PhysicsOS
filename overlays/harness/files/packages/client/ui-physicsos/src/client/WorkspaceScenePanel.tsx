/** Scene outline floats above the continuous bench and uses the same scene tree. */
import type { ReactNode } from 'react'
import type { ResponsiveInspectorController } from './ResponsiveInspector.tsx'
import { WorkbenchFloatPanel, type WorkbenchFloatPanelProps } from './WorkbenchFloatPanel.tsx'

export function WorkspaceScenePanel({ controller, label, closeLabel, collapseLabel, onCollapse, children, layout, storageKey, onActivate }: {
  readonly controller: ResponsiveInspectorController
  readonly label: string
  readonly closeLabel: string
  readonly collapseLabel?: string
  readonly onCollapse?: () => void
  readonly children: ReactNode
  readonly layout?: WorkbenchFloatPanelProps['layout']
  readonly storageKey?: string
  readonly onActivate?: () => void
}) {
  const close = () => { controller.close(); onCollapse?.() }
  return <WorkbenchFloatPanel id={controller.id} title={label} closeLabel={closeLabel} collapseLabel={collapseLabel}
    onClose={close} onCollapse={close} placement="top-left" width={230} height={300} expanded={controller.open} layout={layout} storageKey={storageKey} onActivate={onActivate}>
    {children}
  </WorkbenchFloatPanel>
}
