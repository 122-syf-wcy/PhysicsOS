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
const TRAIL_LENGTH = 16
const FLASH_LIFE = 520
const POINTER_RADIUS = 96
const GRID = 26

const readToken = (host: Element, name: string, fallback: string): string => {
  const value = getComputedStyle(host).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

interface Collider {
  x: number
  y: number
  r: number
}

const spawn = (width: number, height: number, colliders: readonly Collider[]): Ball[] => {
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

    const palette: Palette = {
      fill: readToken(host, '--physics-body-fill', '#dce7f7'),
      stroke: readToken(host, '--physics-body-stroke', '#33507f'),
      live: readToken(host, '--physics-body-live', '#2563eb'),
      trajectory: readToken(host, '--physics-trajectory', '#2563eb'),
      velocity: readToken(host, '--physics-vector-velocity', '#2f9e5a'),
      grid: readToken(host, '--physics-grid-major', '#d3e0f2'),
      ring: readToken(host, '--physics-highlight', '#f5a524'),
    }

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
        balls = spawn(width, height, colliders())
      } else {
        for (const ball of balls) {
          ball.x = Math.min(Math.max(ball.x, ball.r), width - ball.r)
          ball.y = Math.min(Math.max(ball.y, ball.r), height - ball.r)
        }
      }
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
          ball.vx = Math.abs(ball.vx)
          flashes.push({ x: 0, y: ball.y, born: last, strength: 0.6 })
        } else if (ball.x + ball.r > width) {
          ball.x = width - ball.r
          ball.vx = -Math.abs(ball.vx)
          flashes.push({ x: width, y: ball.y, born: last, strength: 0.6 })
        }
        if (ball.y - ball.r < 0) {
          ball.y = ball.r
          ball.vy = Math.abs(ball.vy)
          flashes.push({ x: ball.x, y: 0, born: last, strength: 0.6 })
        } else if (ball.y + ball.r > height) {
          ball.y = height - ball.r
          ball.vy = -Math.abs(ball.vy)
          flashes.push({ x: ball.x, y: height, born: last, strength: 0.6 })
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
              flashes.push({ x: c.x + nx * c.r, y: c.y + ny * c.r, born: last, strength: 1 })
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
            flashes.push({
              x: a.x + nx * a.r,
              y: a.y + ny * a.r,
              born: last,
              strength: Math.min(1, Math.abs(vn) / 160),
            })
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
        ball.trail.push({ x: ball.x, y: ball.y })
        if (ball.trail.length > TRAIL_LENGTH) ball.trail.shift()
      }
      while (flashes.length > 0 && last - (flashes[0]?.born ?? last) > FLASH_LIFE) flashes.shift()
      if (flashes.length > 24) flashes.splice(0, flashes.length - 24)
    }

    const draw = (now: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      /* Faint lab grid, same idea as the PhysicsCanvas minor grid. */
      context.beginPath()
      for (let x = GRID; x < width; x += GRID) {
        context.moveTo(x + 0.5, 0)
        context.lineTo(x + 0.5, height)
      }
      for (let y = GRID; y < height; y += GRID) {
        context.moveTo(0, y + 0.5)
        context.lineTo(width, y + 0.5)
      }
      context.strokeStyle = palette.grid
      context.globalAlpha = 0.34
      context.lineWidth = 1
      context.stroke()
      context.globalAlpha = 1

      /* Trails. */
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
          context.globalAlpha = 0.04 + t * 0.26
          context.lineWidth = 1.2 + t * 0.9
          context.lineCap = 'round'
          context.stroke()
        }
      }
      context.globalAlpha = 1

      /* Contact flashes: an expanding ring that fades — the "碰撞" beat. */
      for (const flash of flashes) {
        const p = Math.min(1, (now - flash.born) / FLASH_LIFE)
        const radius = 4 + p * (18 + flash.strength * 16)
        context.beginPath()
        context.arc(flash.x, flash.y, radius, 0, Math.PI * 2)
        context.strokeStyle = palette.live
        context.globalAlpha = (1 - p) * (0.28 + flash.strength * 0.36)
        context.lineWidth = 1.6 - p
        context.stroke()
        if (flash.strength > 0.7) {
          context.beginPath()
          context.arc(flash.x, flash.y, radius * 0.55, 0, Math.PI * 2)
          context.fillStyle = palette.live
          context.globalAlpha = (1 - p) * 0.1
          context.fill()
        }
      }
      context.globalAlpha = 1

      /* Balls. */
      for (const ball of balls) {
        context.beginPath()
        context.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
        context.fillStyle = palette.fill
        context.fill()
        context.lineWidth = 1.5
        context.strokeStyle = ball.r >= 12 ? palette.live : palette.stroke
        context.stroke()
        /* Specular dot, mirroring the canvas body primitive. */
        context.beginPath()
        context.arc(ball.x - ball.r * 0.32, ball.y - ball.r * 0.34, ball.r * 0.24, 0, Math.PI * 2)
        context.fillStyle = 'rgba(255,255,255,0.7)'
        context.fill()

        /* Velocity arrow on the larger bodies. */
        if (ball.r >= 12) {
          const speed = Math.hypot(ball.vx, ball.vy)
          if (speed > 1) {
            const len = 14 + (speed / MAX_SPEED) * 22
            const ux = ball.vx / speed
            const uy = ball.vy / speed
            const sx = ball.x + ux * (ball.r + 2)
            const sy = ball.y + uy * (ball.r + 2)
            const ex = sx + ux * len
            const ey = sy + uy * len
            context.beginPath()
            context.moveTo(sx, sy)
            context.lineTo(ex, ey)
            context.strokeStyle = palette.velocity
            context.lineWidth = 1.8
            context.lineCap = 'round'
            context.stroke()
            context.beginPath()
            context.moveTo(ex + ux * 5, ey + uy * 5)
            context.lineTo(ex - uy * 3.4, ey + ux * 3.4)
            context.lineTo(ex + uy * 3.4, ey - ux * 3.4)
            context.closePath()
            context.fillStyle = palette.velocity
            context.fill()
          }
        }
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
      for (const ball of balls) {
        const dx = ball.x - x
        const dy = ball.y - y
        const d = Math.hypot(dx, dy) || 1
        if (d < 180) {
          const push = (1 - d / 180) * 240
          ball.vx += (dx / d) * push
          ball.vy += (dy / d) * push
        }
      }
      flashes.push({ x, y, born: performance.now(), strength: 1 })
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    host.addEventListener('pointerdown', onDown)

    return () => {
      stop()
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
