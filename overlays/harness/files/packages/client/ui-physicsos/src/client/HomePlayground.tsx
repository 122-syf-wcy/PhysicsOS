/**
 * Home hero playground — a small live world of elastic collisions.
 *
 * DECORATIVE ONLY. This is brand motion for the landing hero, not a physics
 * result: it never touches PhysicsScene, an Engine or the PhysicsCanvas, and no
 * number it produces is shown to a student. A handful of balls drift in a
 * frictionless box, bounce off the walls, off each other and off the mascot
 * (a static circular collider), leaving short trajectory trails and flashing a
 * ring at every contact point. The pointer gently repels them so the hero
 * responds to the hand before the student has typed anything.
 *
 * The drawing follows the PhysicsCanvas body primitive so the hero reads as the
 * same product: a lit sphere (specular glint, rim, inner hairline, contact
 * shadow), a minor/major grid, and velocity arrows on a white halo so they stay
 * legible over the grid. Contact flashes scale with the impact, so a graze
 * barely marks the frame and a real hit rings.
 *
 * The loop honours prefers-reduced-motion (one static frame), pauses while the
 * hero is scrolled out of view or the tab is hidden, and draws in CSS pixels on
 * a DPR-scaled canvas so strokes stay crisp on any display.
 */

import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import css from './HomePlayground.module.css'

interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  m: number
  /** Spawn time in ms; drives the pop-in only — the physics radius is `r`. */
  born: number
  /** Ring buffer of recent positions for the trail. */
  trail: { x: number; y: number }[]
}

interface Flash {
  x: number
  y: number
  born: number
  strength: number
}

interface Palette {
  fill: string
  stroke: string
  live: string
  trajectory: string
  velocity: string
  grid: string
  ring: string
}

const readPalette = (host: Element): Palette => ({
  fill: readToken(host, '--physics-body-fill', '#dce7f7'),
  stroke: readToken(host, '--physics-body-stroke', '#33507f'),
  live: readToken(host, '--physics-body-live', '#2563eb'),
  trajectory: readToken(host, '--physics-trajectory', '#2563eb'),
  velocity: readToken(host, '--physics-vector-velocity', '#2f9e5a'),
  grid: readToken(host, '--physics-grid-major', '#d3e0f2'),
  ring: readToken(host, '--physics-highlight', '#f5a524'),
})

/**
 * Where the mascot figure sits on the stage, in units of the stage HEIGHT —
 * mirrors the CSS placement in HomeBrand.module.css (.mascot): the cut-out is
 * `height` tall, its bottom `bottom` up from the floor, its right edge `right`
 * in from the stage's right edge. The figure is the `wave` pose (girl + cat).
 */
export const MASCOT_PLACEMENT = { height: 0.92, bottom: 0, right: 0.06, aspect: 776 / 976 } as const

/**
 * Immovable colliders the balls bounce off, as fractions of the cut-out's own
 * width (x) and height (y, r): head + torso, legs, and the kitten.
 */
export const MASCOT_COLLIDERS: readonly { x: number; y: number; r: number }[] = [
  { x: 0.42, y: 0.3, r: 0.24 },
  { x: 0.4, y: 0.68, r: 0.15 },
  { x: 0.78, y: 0.8, r: 0.15 },
]

const BALL_COUNT = 7
const MIN_SPEED = 42
const MAX_SPEED = 190
/** Bodies at or above this radius carry the live rim and a velocity arrow. */
const HEAVY_R = 12
const TRAIL_LENGTH = 16
const FLASH_LIFE = 520
const POINTER_RADIUS = 96
const GRID = 26
/** Pop-in duration and the stagger between balls, ms. */
const ENTRANCE_LIFE = 340
const ENTRANCE_STAGGER = 70
/** Below this impact speed a contact is too gentle to deserve a ring. */
const MIN_FLASH_SPEED = 26

const readToken = (host: Element, name: string, fallback: string): string => {
  const value = getComputedStyle(host).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/** Canvas gradients take the body stroke's RGB so the shading tracks the theme. */
const rgbTriple = (color: string): readonly [number, number, number] => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex?.[1] !== undefined) {
    let digits = hex[1]
    if (digits.length === 3) digits = digits.replace(/./g, ch => ch + ch)
    const value = Number.parseInt(digits, 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  const nums = color.match(/\d+(?:\.\d+)?/g)
  if (nums === null || nums.length < 3) return [51, 80, 127]
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])]
}

interface Collider {
  x: number
  y: number
  r: number
}

const spawn = (
  width: number,
  height: number,
  colliders: readonly Collider[],
  now: number,
  stagger: number,
): Ball[] => {
  const balls: Ball[] = []
  let guard = 0
  while (balls.length < BALL_COUNT && guard < 400) {
    guard += 1
    const r = rand(8, 16)
    const x = rand(r + 6, Math.max(r + 8, width * 0.68))
    const y = rand(r + 6, height - r - 6)
    if (colliders.some(c => Math.hypot(x - c.x, y - c.y) < c.r + r + 8)) continue
    if (balls.some(other => Math.hypot(other.x - x, other.y - y) < other.r + r + 6)) continue
    const speed = rand(60, 130)
    const angle = rand(0, Math.PI * 2)
    balls.push({
      x, y, r,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      m: r * r,
      born: now + balls.length * stagger,
      trail: [],
    })
  }
  return balls
}

/** Keep every ball's speed inside the band the hero was tuned for. */
const clampSpeed = (ball: Ball): void => {
  const speed = Math.hypot(ball.vx, ball.vy)
  if (speed < 1e-6) {
    ball.vx = MIN_SPEED
    return
  }
  const target = speed > MAX_SPEED ? MAX_SPEED : speed < MIN_SPEED ? MIN_SPEED : speed
  if (target !== speed) {
    const k = target / speed
    ball.vx *= k
    ball.vy *= k
  }
}

/** easeOutBack: the sphere overshoots a hair and settles, like a bubble surfacing. */
const popScale = (ball: Ball, now: number): number => {
  const p = clamp01((now - ball.born) / ENTRANCE_LIFE)
  if (p >= 1) return 1
  if (p <= 0) return 0
  const c1 = 1.70158
  const c3 = c1 + 1
  return 0.5 + 0.5 * (1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2)
}

export interface HomePlaygroundProps {
  readonly className?: string | undefined
}

export function HomePlayground({ className }: HomePlaygroundProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (host === null || canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    let palette = readPalette(host)
    const refreshPalette = () => { palette = readPalette(host) }
    const themeObserver = new MutationObserver(refreshPalette)
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'class', 'style'],
    })

    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let dpr = 1
    let balls: Ball[] = []
    const flashes: Flash[] = []
    let pointer: { x: number; y: number } | null = null
    let frame = 0
    let last = 0
    let visible = true
    let hidden = document.visibilityState === 'hidden'

    /* The mascot is a sibling laid out by CSS; its live box is the truth, so
       the colliders follow whatever breakpoint the stylesheet chose. The
       MASCOT_PLACEMENT constants only cover the frame before it has a box. */
    const colliders = (): Collider[] => {
      const stage = host.getBoundingClientRect()
      const figure = host.parentElement?.querySelector('[data-physicsos-mascot]')?.getBoundingClientRect()
      const box = figure !== undefined && figure.width > 1
        ? {
          left: figure.left - stage.left,
          top: figure.top - stage.top,
          width: figure.width,
          height: figure.height,
        }
        : (() => {
          const figureH = height * MASCOT_PLACEMENT.height
          const figureW = figureH * MASCOT_PLACEMENT.aspect
          return {
            left: width - height * MASCOT_PLACEMENT.right - figureW,
            top: height - height * MASCOT_PLACEMENT.bottom - figureH,
            width: figureW,
            height: figureH,
          }
        })()
      return MASCOT_COLLIDERS.map(c => ({
        x: box.left + c.x * box.width,
        y: box.top + c.y * box.height,
        r: c.r * box.height,
      }))
    }

    const measure = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      width = rect.width
      height = rect.height
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      if (balls.length === 0) {
        balls = spawn(width, height, colliders(), performance.now(), ENTRANCE_STAGGER)
        /* Reduced motion draws exactly one frame, so the entrance is skipped
           rather than frozen half-open. */
        if (reduceMotion) for (const ball of balls) ball.born = 0
      } else {
        for (const ball of balls) {
          ball.x = Math.min(Math.max(ball.x, ball.r), width - ball.r)
          ball.y = Math.min(Math.max(ball.y, ball.r), height - ball.r)
        }
      }
    }

    /* A contact only earns a ring if it was felt; grazes stay silent. */
    const flashAt = (x: number, y: number, speed: number, scale: number): void => {
      if (speed < MIN_FLASH_SPEED) return
      flashes.push({ x, y, born: last, strength: Math.min(1, speed / scale) })
    }

    const step = (dt: number) => {
      const solids = colliders()
      for (const ball of balls) {
        /* Pointer: a soft repulsive field so the hand stirs the world. */
        if (pointer !== null) {
          const dx = ball.x - pointer.x
          const dy = ball.y - pointer.y
          const d = Math.hypot(dx, dy)
          if (d > 1e-3 && d < POINTER_RADIUS + ball.r) {
            const push = (1 - d / (POINTER_RADIUS + ball.r)) * 620 * dt
            ball.vx += (dx / d) * push
            ball.vy += (dy / d) * push
          }
        }
        ball.x += ball.vx * dt
        ball.y += ball.vy * dt

        /* Walls. */
        if (ball.x - ball.r < 0) {
          ball.x = ball.r
          const impact = Math.abs(ball.vx)
          ball.vx = impact
          flashAt(2, ball.y, impact, 170)
        } else if (ball.x + ball.r > width) {
          ball.x = width - ball.r
          const impact = Math.abs(ball.vx)
          ball.vx = -impact
          flashAt(width - 2, ball.y, impact, 170)
        }
        if (ball.y - ball.r < 0) {
          ball.y = ball.r
          const impact = Math.abs(ball.vy)
          ball.vy = impact
          flashAt(ball.x, 2, impact, 170)
        } else if (ball.y + ball.r > height) {
          ball.y = height - ball.r
          const impact = Math.abs(ball.vy)
          ball.vy = -impact
          flashAt(ball.x, height - 2, impact, 170)
        }

        /* Mascot: immovable solids. Reflect the normal component. */
        for (const c of solids) {
          const dx = ball.x - c.x
          const dy = ball.y - c.y
          const d = Math.hypot(dx, dy)
          const minD = c.r + ball.r
          if (d > 1e-6 && d < minD) {
            const nx = dx / d
            const ny = dy / d
            const vn = ball.vx * nx + ball.vy * ny
            if (vn < 0) {
              ball.vx -= 2 * vn * nx
              ball.vy -= 2 * vn * ny
              flashAt(c.x + nx * c.r, c.y + ny * c.r, -vn, 150)
            }
            ball.x = c.x + nx * minD
            ball.y = c.y + ny * minD
          }
        }
      }

      /* Ball–ball elastic collisions, mass ∝ r². */
      for (const [i, a] of balls.entries()) {
        for (const b of balls.slice(i + 1)) {
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.hypot(dx, dy)
          const minD = a.r + b.r
          if (d < 1e-6 || d >= minD) continue
          const nx = dx / d
          const ny = dy / d
          const rvx = b.vx - a.vx
          const rvy = b.vy - a.vy
          const vn = rvx * nx + rvy * ny
          if (vn < 0) {
            const impulse = (2 * vn) / (a.m + b.m)
            a.vx += impulse * b.m * nx
            a.vy += impulse * b.m * ny
            b.vx -= impulse * a.m * nx
            b.vy -= impulse * a.m * ny
            flashAt(a.x + nx * a.r, a.y + ny * a.r, -vn, 160)
          }
          /* Separate so they never sink into each other. */
          const overlap = (minD - d) / 2
          a.x -= nx * overlap
          a.y -= ny * overlap
          b.x += nx * overlap
          b.y += ny * overlap
        }
      }

      for (const ball of balls) {
        clampSpeed(ball)
        /* No wake before the body has surfaced. */
        if (last >= ball.born) {
          ball.trail.push({ x: ball.x, y: ball.y })
          if (ball.trail.length > TRAIL_LENGTH) ball.trail.shift()
        }
      }
      while (flashes.length > 0 && last - (flashes[0]?.born ?? last) > FLASH_LIFE) flashes.shift()
      if (flashes.length > 24) flashes.splice(0, flashes.length - 24)
    }

    const drawGrid = () => {
      /* Minor grid every cell, major every fourth — the PhysicsCanvas
         convention at a fraction of its weight, so it reads as paper. */
      context.strokeStyle = palette.grid
      context.lineWidth = 1
      for (const [alpha, major] of [[0.2, false], [0.36, true]] as [number, boolean][]) {
        context.globalAlpha = alpha
        context.beginPath()
        for (let x = GRID, i = 1; x < width; x += GRID, i += 1) {
          if ((i % 4 === 0) !== major) continue
          context.moveTo(x + 0.5, 0)
          context.lineTo(x + 0.5, height)
        }
        for (let y = GRID, i = 1; y < height; y += GRID, i += 1) {
          if ((i % 4 === 0) !== major) continue
          context.moveTo(0, y + 0.5)
          context.lineTo(width, y + 0.5)
        }
        context.stroke()
      }
      context.globalAlpha = 1
    }

    const drawTrails = () => {
      for (const ball of balls) {
        if (ball.trail.length < 2) continue
        for (const [i, to] of ball.trail.entries()) {
          const from = ball.trail[i - 1]
          if (from === undefined) continue
          const t = i / ball.trail.length
          context.beginPath()
          context.moveTo(from.x, from.y)
          context.lineTo(to.x, to.y)
          context.strokeStyle = palette.trajectory
          context.globalAlpha = 0.03 + t * (ball.r >= HEAVY_R ? 0.24 : 0.15)
          /* The wake is proportional to the body: a light ball drags a thread,
             a heavy one a ribbon. */
          context.lineWidth = Math.min(3.4, ball.r * (0.1 + t * 0.13))
          context.lineCap = 'round'
          context.stroke()
        }
      }
      context.globalAlpha = 1
    }

    const drawFlashes = (now: number) => {
      /* Expanding ring — the "碰撞" beat. The radius eases out so the ring snaps
         open then drifts; a hard hit echoes in the amber highlight. */
      for (const flash of flashes) {
        const age = (now - flash.born) / FLASH_LIFE
        if (age < 0) continue
        const p = clamp01(age)
        const radius = 4 + (1 - (1 - p) * (1 - p)) * (16 + flash.strength * 18)
        const fade = 1 - p
        context.beginPath()
        context.arc(flash.x, flash.y, radius, 0, Math.PI * 2)
        context.strokeStyle = palette.live
        context.globalAlpha = fade * (0.24 + flash.strength * 0.4)
        context.lineWidth = 1.7 - p * 1.1
        context.stroke()
        if (flash.strength > 0.55) {
          context.beginPath()
          context.arc(flash.x, flash.y, radius * 0.62, 0, Math.PI * 2)
          context.strokeStyle = palette.ring
          context.globalAlpha = fade * 0.4 * flash.strength
          context.lineWidth = 1
          context.stroke()
        }
        if (flash.strength > 0.7) {
          context.beginPath()
          context.arc(flash.x, flash.y, radius * 0.4, 0, Math.PI * 2)
          context.fillStyle = palette.live
          context.globalAlpha = fade * 0.12 * flash.strength
          context.fill()
        }
      }
      context.globalAlpha = 1
    }

    const drawBody = (ball: Ball, now: number) => {
      const scale = popScale(ball, now)
      if (scale <= 0.01) return
      const r = ball.r * scale
      const heavy = ball.r >= HEAVY_R
      const sx = ball.x + r * 0.2
      const sy = ball.y + r * 0.34
      /* The shading is derived from the body stroke so it follows whatever
         theme token the canvas is painted with, instead of a fixed navy. */
      const [sr, sg, sb] = rgbTriple(palette.stroke)
      const rgba = (alpha: number): string => `rgba(${sr}, ${sg}, ${sb}, ${alpha})`

      /* Contact shadow, offset down-right: the sphere floats above the paper. */
      const shadow = context.createRadialGradient(sx, sy, r * 0.1, sx, sy, r * 1.18)
      shadow.addColorStop(0, rgba(0.16))
      shadow.addColorStop(1, rgba(0))
      context.beginPath()
      context.arc(sx, sy, r * 1.18, 0, Math.PI * 2)
      context.fillStyle = shadow
      context.fill()

      context.beginPath()
      context.arc(ball.x, ball.y, r, 0, Math.PI * 2)
      context.fillStyle = palette.fill
      context.fill()

      /* Lit from the upper left, darkened toward the rim. */
      const shade = context.createRadialGradient(
        ball.x - r * 0.3, ball.y - r * 0.34, r * 0.15,
        ball.x, ball.y, r,
      )
      shade.addColorStop(0, 'rgba(255, 255, 255, 0.6)')
      shade.addColorStop(0.42, 'rgba(255, 255, 255, 0)')
      shade.addColorStop(0.86, rgba(0.07))
      shade.addColorStop(1, rgba(0.19))
      context.fillStyle = shade
      context.fill()

      context.lineWidth = heavy ? 1.7 : 1.4
      context.strokeStyle = heavy ? palette.live : palette.stroke
      context.globalAlpha = heavy ? 0.95 : 0.78
      context.stroke()
      context.globalAlpha = 1

      /* Inner hairline just inside the rim — the same glass edge the canvas
         bodies carry; it keeps the sphere crisp where trails cross it. */
      if (r > 6) {
        context.beginPath()
        context.arc(ball.x, ball.y, r - 2.6, 0, Math.PI * 2)
        context.strokeStyle = 'rgba(255, 255, 255, 0.4)'
        context.lineWidth = 1
        context.stroke()
      }

      /* Specular glint, plus a small bounce-light dot opposite it. */
      context.beginPath()
      context.arc(ball.x - r * 0.34, ball.y - r * 0.36, r * 0.23, 0, Math.PI * 2)
      context.fillStyle = 'rgba(255, 255, 255, 0.8)'
      context.fill()
      if (r > 9) {
        context.beginPath()
        context.arc(ball.x + r * 0.3, ball.y + r * 0.42, r * 0.1, 0, Math.PI * 2)
        context.fillStyle = 'rgba(255, 255, 255, 0.32)'
        context.fill()
      }
    }

    const arrowHead = (ex: number, ey: number, ux: number, uy: number, size: number, wing: number) => {
      context.beginPath()
      context.moveTo(ex + ux * size, ey + uy * size)
      context.lineTo(ex - uy * wing, ey + ux * wing)
      context.lineTo(ex + uy * wing, ey - ux * wing)
      context.closePath()
    }

    const drawVelocityArrow = (ball: Ball, now: number) => {
      const speed = Math.hypot(ball.vx, ball.vy)
      /* A near-stopped body has no honest direction: fade the arrow out instead
         of letting it spin through a full revolution as the vector flips. */
      const alpha = clamp01((speed - 14) / 44) * popScale(ball, now)
      if (alpha <= 0.02) return
      const scale = popScale(ball, now)
      const r = ball.r * scale
      /* sqrt so the arrow grows with momentum without running off the stage. */
      const len = (10 + Math.sqrt(Math.min(speed / MAX_SPEED, 1.25)) * (ball.r * 0.55 + 12)) * scale
      const ux = ball.vx / speed
      const uy = ball.vy / speed
      const sx = ball.x + ux * (r + 3.5)
      const sy = ball.y + uy * (r + 3.5)
      const ex = sx + ux * len
      const ey = sy + uy * len
      const size = 5.2 + ball.r * 0.13
      const wing = 3.2 + ball.r * 0.08
      const tailX = ex - ux * size * 0.5
      const tailY = ey - uy * size * 0.5

      context.globalAlpha = alpha
      context.lineCap = 'round'
      context.lineJoin = 'round'
      /* White halo under the coloured stroke so the arrow reads on the grid,
         across a trail, or over the body it is leaving. */
      context.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      context.lineWidth = 4.4
      context.beginPath()
      context.moveTo(sx, sy)
      context.lineTo(tailX, tailY)
      context.stroke()
      arrowHead(ex, ey, ux, uy, size, wing)
      context.fillStyle = 'rgba(255, 255, 255, 0.8)'
      context.fill()

      context.strokeStyle = palette.velocity
      context.lineWidth = 1.9
      context.beginPath()
      context.moveTo(sx, sy)
      context.lineTo(tailX, tailY)
      context.stroke()
      arrowHead(ex, ey, ux, uy, size, wing)
      context.fillStyle = palette.velocity
      context.fill()
      context.globalAlpha = 1
    }

    const draw = (now: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      drawGrid()
      drawTrails()
      drawFlashes(now)

      /* Light bodies first, heavy ones last: the stack reads with depth and the
         big spheres carry the eye across the stage. */
      const ordered = [...balls].sort((a, b) => a.r - b.r)
      for (const ball of ordered) drawBody(ball, now)
      /* Arrows above every body, so a vector is never clipped by a neighbour. */
      for (const ball of ordered) {
        if (ball.r >= HEAVY_R) drawVelocityArrow(ball, now)
      }
    }

    const tick = (now: number) => {
      frame = 0
      if (!visible || hidden) return
      if (last === 0) last = now
      let elapsed = Math.min(48, now - last)
      last = now
      /* Fixed-ish substeps keep fast balls from tunnelling through each other. */
      while (elapsed > 0) {
        const dt = Math.min(elapsed, 12)
        step(dt / 1000)
        elapsed -= dt
      }
      draw(now)
      frame = requestAnimationFrame(tick)
    }

    const start = () => {
      if (reduceMotion) {
        if (balls.length > 0) {
          last = performance.now()
          draw(last)
        }
        return
      }
      if (frame === 0 && visible && !hidden) {
        last = 0
        frame = requestAnimationFrame(tick)
      }
    }
    const stop = () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    }

    measure()
    start()

    const resize = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        measure()
        if (reduceMotion) draw(performance.now())
      })
    resize?.observe(host)

    const intersection = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
        visible = entries.some(entry => entry.isIntersecting)
        if (visible) start()
        else stop()
      }, { threshold: 0.05 })
    intersection?.observe(host)

    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden'
      if (hidden) stop()
      else start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const onLeave = () => { pointer = null }
    const onDown = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      let strongest = 0
      for (const ball of balls) {
        const dx = ball.x - x
        const dy = ball.y - y
        const d = Math.hypot(dx, dy) || 1
        if (d < 180) {
          const push = (1 - d / 180) * 240
          ball.vx += (dx / d) * push
          ball.vy += (dy / d) * push
          strongest = Math.max(strongest, push)
        }
      }
      flashes.push({ x, y, born: performance.now(), strength: strongest > 0 ? clamp01(strongest / 200) : 1 })
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    host.addEventListener('pointerdown', onDown)

    return () => {
      stop()
      themeObserver.disconnect()
      resize?.disconnect()
      intersection?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      host.removeEventListener('pointerdown', onDown)
    }
  }, [])

  return (
    <div ref={hostRef} className={clsx(css.root, className)} aria-hidden="true">
      <canvas ref={canvasRef} className={css.canvas} />
    </div>
  )
}
