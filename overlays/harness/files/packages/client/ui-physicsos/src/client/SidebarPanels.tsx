/**
 * Sidebar global-panel glyphs for the PhysicsOS product surfaces.
 *
 * The target sidebar owns the navigation rows (label, tooltip, active state,
 * and the narrow-viewport drawer) and asks each `sidebar.panellist` occupant
 * only for the glyph at the size that state wants. The product's rail
 * therefore stays a real part of the shell instead of a private button list.
 */

import type { ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconListPenOutlineMedium, IconShieldOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconAnnouncement, IconLibrary, IconPhysicsLab, IconQuestionSheet,
} from './icons/physics-icons.tsx'

/** One product glyph, sized by the sidebar's own state. */
type GlyphComponent = (props: { size?: number | undefined; className?: string | undefined }) => ReactElement

/**
 * Build one panel-row glyph component.
 * @param Glyph - the product glyph; it takes the shell's requested edge.
 * @returns a `sidebar.panellist` occupant that renders only the glyph (the
 *   shell owns the row's accessible name).
 */
function panelGlyph(Glyph: GlyphComponent) {
  return function PanelGlyph({
    size,
  }: Pick<PropsRuntime<'sidebar.panellist'>, 'size' | 'active'>): ReactElement {
    return <Glyph size={size} />
  }
}

/** 物理实验室 row glyph. */
export const LabPanelIcon = panelGlyph(IconPhysicsLab)
/** 出卷专区 row glyph. */
export const PaperPanelIcon = panelGlyph(IconQuestionSheet)
/** 反馈 row glyph. */
export const NoticePanelIcon = panelGlyph(IconAnnouncement)
/** 资源库 row glyph. */
export const LibraryPanelIcon = panelGlyph(IconLibrary)
/** 学习记录 row glyph. */
export const RecordPanelIcon = panelGlyph(IconListPenOutlineMedium)
/** 管理后台 row glyph. */
export const AdminPanelIcon = panelGlyph(IconShieldOutlineMedium)

/** The occupant shape every PhysicsOS panellist row shares. */
export type PhysicsPanelIcon = typeof LabPanelIcon
