/**
 * Vector label layout.
 *
 * On an inclined plane every arrow starts at the same point, so naive "label at
 * the arrow tip" placement stacks mg, N, f and a on top of each other. This
 * module resolves label boxes in SCREEN space (labels must not scale with the
 * scene) by pushing each colliding label along the direction its own arrow
 * points, so a label always stays visually attached to its arrow.
 *
 * Pure geometry, no React and no physics: it moves text, never a vector.
 */

export interface LabelBox {
  id: string
  /** Anchor: the arrow tip, in screen px. */
  x: number
  y: number
  width: number
  height: number
  /** Unit direction of the arrow, screen space (y already flipped). */
  dirX: number
  dirY: number
  anchor: 'start' | 'middle' | 'end'
}

export interface PlacedLabel {
  id: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  /** True when the solver had to push this label off its preferred spot. */
  displaced: boolean
  /** Leader line back to the arrow tip, emitted only when pushed far. */
  leader?: { x1: number; y1: number; x2: number; y2: number }
}

/** Gap between the arrow tip and its label, in px. */
const TIP_GAP = 9
/** Minimum clear space between two label boxes, in px. */
const PADDING = 3
/** Push increment per relaxation round, in px. */
const STEP = 5
const MAX_ROUNDS = 24
/** Beyond this displacement a label gets a leader line back to its arrow. */
const LEADER_THRESHOLD = 15

interface Placed {
  box: LabelBox
  x: number
  y: number
  originX: number
  originY: number
}

const overlaps = (a: Placed, b: Placed): boolean => {
  const ax = a.x - halfWidth(a)
  const bx = b.x - halfWidth(b)
  return (
    ax < bx + b.box.width + PADDING &&
    ax + a.box.width + PADDING > bx &&
    a.y - a.box.height < b.y + PADDING &&
    a.y + PADDING > b.y - b.box.height
  )
}

/** Horizontal offset from the anchor point to the box's left edge. */
const halfWidth = (placed: Placed): number => {
  if (placed.box.anchor === 'middle') return placed.box.width / 2
  if (placed.box.anchor === 'end') return placed.box.width
  return 0
}

/**
 * Place labels so none overlap, pushing each along its own arrow direction.
 *
 * @param boxes - One entry per label, anchored at its arrow tip in screen px.
 * @returns Resolved positions in the same order.
 */
export const layoutVectorLabels = (boxes: readonly LabelBox[]): readonly PlacedLabel[] => {
  /* Seed each label one gap beyond its arrow tip, along the arrow. A label that
     starts on the correct side of its own arrow usually needs no push at all. */
  const placed: Placed[] = boxes.map((box) => {
    const length = Math.hypot(box.dirX, box.dirY)
    const ux = length === 0 ? 1 : box.dirX / length
    const uy = length === 0 ? 0 : box.dirY / length
    const x = box.x + ux * TIP_GAP
    const y = box.y + uy * TIP_GAP + box.height * 0.34
    return { box, x, y, originX: x, originY: y }
  })

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let moved = false
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (a === undefined || b === undefined) continue
        if (!overlaps(a, b)) continue

        /* Push the later label along its own arrow so the pairing stays
           readable. A degenerate (zero-length) arrow falls back to a vertical
           nudge, which is still deterministic. */
        const length = Math.hypot(b.box.dirX, b.box.dirY)
        const ux = length === 0 ? 0 : b.box.dirX / length
        const uy = length === 0 ? 1 : b.box.dirY / length
        b.x += ux * STEP
        b.y += uy * STEP
        moved = true
      }
    }
    if (!moved) break
  }

  return placed.map((entry) => {
    const dx = entry.x - entry.originX
    const dy = entry.y - entry.originY
    const displacement = Math.hypot(dx, dy)
    const needsLeader = displacement > LEADER_THRESHOLD
    return {
      id: entry.box.id,
      x: entry.x,
      y: entry.y,
      anchor: entry.box.anchor,
      displaced: displacement > 0.5,
      ...(needsLeader
        ? {
          leader: {
            x1: entry.box.x,
            y1: entry.box.y,
            x2: entry.x - (entry.box.anchor === 'end' ? -2 : 2),
            y2: entry.y - entry.box.height * 0.3,
          },
        }
        : {}),
    }
  })
}

/**
 * Estimated width of a rendered math label, in px.
 *
 * The canvas is SVG, so there is no layout pass to measure against before
 * placement. Physics symbols are short and predictable (`v`, `v_x`, `mg\\sinθ`),
 * so a per-character estimate that slightly OVER-estimates is the right trade:
 * it errs toward extra spacing rather than toward collisions.
 */
export const estimateLabelWidth = (symbol: string, fontSize: number): number => {
  /* Sub/superscript markers cost roughly half a glyph; the rest are full. */
  const visible = symbol.replace(/[_^{}\\]/g, '')
  const scripts = (symbol.match(/[_^]/g) ?? []).length
  return Math.max(fontSize * 0.72, visible.length * fontSize * 0.56 + scripts * fontSize * 0.1)
}
