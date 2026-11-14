/**
 * PhysicsOS' approved Guizhou-inspired tutor. The existing girl's identity is
 * retained across five clothing and action variants, without the former cat.
 * Silverwork and embroidery are contemporary interpretations; culture sources
 * and generation provenance live in apps/web/design-assets/mascot-guizhou-v1.
 *
 * AVIF exports preserve alpha; PNG is the compatibility fallback. Descriptors
 * use each export's actual pixel width, rather than its export height.
 */
import clsx from 'clsx'
import type { CSSProperties } from 'react'
import css from './Mascot.module.css'

type AssetPose = 'wave' | 'think' | 'search' | 'explain' | 'complete'
export type MascotPose = AssetPose | 'thinking' | 'searching' | 'explaining'

export interface MascotProps {
  readonly pose?: MascotPose
  /** Rendered height in px (full figure) or diameter (avatar). */
  readonly size?: number
  readonly variant?: 'figure' | 'avatar'
  /** Presentation-only breathing; never represents simulation state. */
  readonly float?: boolean
  readonly className?: string | undefined
  /** Omit for a decorative illustration. Status copy belongs to the caller. */
  readonly alt?: string | undefined
}

const HEIGHTS = [160, 320, 640] as const
const SOURCE = {
  wave: { width: 1118, height: 1407, exportWidths: [127, 254, 508], face: { x: 0.48, y: 0.235 } },
  think: { width: 1118, height: 1407, exportWidths: [127, 254, 508], face: { x: 0.50, y: 0.265 } },
  search: { width: 1199, height: 1312, exportWidths: [146, 292, 585], face: { x: 0.51, y: 0.35 } },
  explain: { width: 1118, height: 1407, exportWidths: [127, 254, 508], face: { x: 0.40, y: 0.25 } },
  complete: { width: 1118, height: 1407, exportWidths: [127, 254, 508], face: { x: 0.49, y: 0.25 } },
} as const

const normalizePose = (pose: MascotPose): AssetPose => pose === 'thinking' ? 'think'
  : pose === 'searching' ? 'search' : pose === 'explaining' ? 'explain' : pose
const figureAspect = 1118 / 1407
const searchAspect = 1199 / 1312

/** Natural canvas ratios reserve the full transparent silhouette before load. */
export const MASCOT_ASPECT: Readonly<Record<MascotPose, number>> = {
  wave: figureAspect, think: figureAspect, search: searchAspect,
  explain: figureAspect, complete: figureAspect,
  thinking: figureAspect, searching: searchAspect, explaining: figureAspect,
}

const AVATAR_ZOOM = 3.4
const assetFor = (pose: AssetPose) => {
  const base = `/physicsos/mascot/guizhou/v1/mascot-${pose}`
  return {
    src: `${base}-320.png`,
    srcSet: HEIGHTS.map((height, index) => `${base}-${height}.avif ${SOURCE[pose].exportWidths[index]}w`).join(', '),
  }
}

export function Mascot({
  pose = 'wave', size = 120, variant = 'figure', float = true, className, alt,
}: MascotProps) {
  const canonical = normalizePose(pose)
  const source = SOURCE[canonical]
  const asset = assetFor(canonical)
  const decorative = alt === undefined
  const aria = {
    'aria-hidden': decorative ? ('true' as const) : undefined,
    role: decorative ? undefined : 'img',
    'aria-label': decorative ? undefined : alt,
  }
  const aspect = MASCOT_ASPECT[pose]
  const figureHeight = variant === 'avatar' ? size * AVATAR_ZOOM : size
  const figureWidth = figureHeight * aspect
  const style = variant === 'avatar' ? {
    '--mascot-size': `${size}px`,
    '--mascot-figure-w': `${figureWidth.toFixed(1)}px`,
    '--mascot-figure-h': `${figureHeight.toFixed(1)}px`,
    '--mascot-face-x': `${(size / 2 - source.face.x * figureWidth).toFixed(1)}px`,
    '--mascot-face-y': `${(size / 2 - source.face.y * figureHeight).toFixed(1)}px`,
  } as CSSProperties : {
    '--mascot-size': `${size}px`,
    '--mascot-aspect': String(aspect),
  } as CSSProperties

  return (
    <span
      className={clsx(variant === 'avatar' ? css.avatar : css.root, variant === 'figure' && float && css.float, className)}
      style={style}
      data-physicsos-mascot={pose}
      data-physicsos-mascot-variant={variant}
      data-physicsos-mascot-edition="guizhou-v1"
      {...aria}
    >
      <picture>
        <source type="image/avif" srcSet={asset.srcSet} sizes={`${Math.round(figureWidth)}px`} />
        <img
          className={variant === 'avatar' ? css.avatarImage : css.image}
          src={asset.src}
          width={source.width}
          height={source.height}
          alt=""
          draggable={false}
          decoding="async"
        />
      </picture>
    </span>
  )
}
