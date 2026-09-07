/**
 * PhysicsOS IP 形象 —— 小物理老师与她的小猫。
 *
 * A storybook-watercolour girl (cap with bear patches, yellow tee, brown
 * shorts) and her grey tabby kitten. Rendered from cut-out WebP assets in
 * `public/physicsos/mascot/` (originals in `UI/generated/mascot/`, produced
 * from the reference illustration and processed by
 * `scripts/design/cutout-mascot.py --white-only`). No frame, no border: the
 * figures stand directly on whatever surface hosts them.
 *
 * Three poses, each a different register the UI can lean on:
 *   wave    greeting — Home hero, welcome states
 *   think   teaching / explaining (pointer raised) — AI 助教, derivations
 *   search  looking for something (magnifier) — pickers, empty states
 *
 * `variant="avatar"` crops to the face inside a small circle for buttons and
 * chips. The idle bob is pure presentation (CSS), collapses under
 * prefers-reduced-motion, and never conveys physics.
 */

import clsx from 'clsx'
import type { CSSProperties } from 'react'
import css from './Mascot.module.css'

export type MascotPose = 'wave' | 'think' | 'search'

export interface MascotProps {
  readonly pose?: MascotPose
  /** Rendered height in px (full figure) or diameter (avatar). */
  readonly size?: number
  /** `figure` = full body with its natural aspect; `avatar` = face crop in a circle. */
  readonly variant?: 'figure' | 'avatar'
  /** Idle bob animation. Default on for figures; ignored for avatars. */
  readonly float?: boolean
  readonly className?: string | undefined
  /** Screen-reader text. Decorative by default (aria-hidden). */
  readonly alt?: string | undefined
}

const SIZES = [160, 320, 640] as const

/**
 * Natural width / height of each cut-out, so a figure sized by height reserves
 * the right width before the image loads (no layout shift).
 */
export const MASCOT_ASPECT: Readonly<Record<MascotPose, number>> = {
  wave: 776 / 976,
  think: 678 / 950,
  search: 752 / 854,
}

/** Face centre as a fraction of the cut-out, for the avatar crop. */
const FACE_AT: Readonly<Record<MascotPose, { x: number; y: number }>> = {
  wave: { x: 0.47, y: 0.2 },
  think: { x: 0.44, y: 0.2 },
  search: { x: 0.5, y: 0.34 },
}

/** How many avatar diameters tall the figure is drawn inside the crop. */
const AVATAR_ZOOM = 3.4

/** Pick the smallest exported asset that still covers the requested px on a 2× display. */
const assetFor = (pose: MascotPose, size: number): { src: string; srcSet: string } => {
  const needed = size * 2
  const chosen = SIZES.find(step => step >= needed) ?? SIZES[SIZES.length - 1]
  const base = `/physicsos/mascot/mascot-${pose}`
  return {
    src: `${base}-${chosen}.webp`,
    srcSet: SIZES.map(step => `${base}-${step}.webp ${step}w`).join(', '),
  }
}

export function Mascot({
  pose = 'wave', size = 120, variant = 'figure', float = true, className, alt,
}: MascotProps) {
  const asset = assetFor(pose, variant === 'avatar' ? size * AVATAR_ZOOM : size)
  const decorative = alt === undefined
  const aria = {
    'aria-hidden': decorative ? ('true' as const) : undefined,
    role: decorative ? undefined : 'img',
    'aria-label': decorative ? undefined : alt,
  }

  if (variant === 'avatar') {
    const face = FACE_AT[pose]
    const figureHeight = size * AVATAR_ZOOM
    const figureWidth = figureHeight * MASCOT_ASPECT[pose]
    const style = {
      '--mascot-size': `${size}px`,
      '--mascot-figure-w': `${figureWidth.toFixed(1)}px`,
      '--mascot-figure-h': `${figureHeight.toFixed(1)}px`,
      '--mascot-face-x': `${(size / 2 - face.x * figureWidth).toFixed(1)}px`,
      '--mascot-face-y': `${(size / 2 - face.y * figureHeight).toFixed(1)}px`,
    } as CSSProperties
    return (
      <span
        className={clsx(css.avatar, className)}
        style={style}
        data-physicsos-mascot={pose}
        data-physicsos-mascot-variant="avatar"
        {...aria}
      >
        <img
          className={css.avatarImage}
          src={asset.src}
          srcSet={asset.srcSet}
          sizes={`${Math.round(figureWidth)}px`}
          alt=""
          draggable={false}
          decoding="async"
        />
      </span>
    )
  }

  const style = {
    '--mascot-size': `${size}px`,
    '--mascot-aspect': String(MASCOT_ASPECT[pose]),
  } as CSSProperties
  return (
    <span
      className={clsx(css.root, float && css.float, className)}
      style={style}
      data-physicsos-mascot={pose}
      {...aria}
    >
      <img
        className={css.image}
        src={asset.src}
        srcSet={asset.srcSet}
        sizes={`${Math.round(size * MASCOT_ASPECT[pose])}px`}
        alt=""
        draggable={false}
        decoding="async"
      />
    </span>
  )
}
