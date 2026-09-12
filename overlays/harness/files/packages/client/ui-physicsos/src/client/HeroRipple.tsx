import { useEffect, useRef } from 'react'
import css from './HeroRipple.module.css'

/**
 * Hero water-ripple background. Decorative only.
 *
 * A fine dot lattice floats on the hero stage like a calm water surface. Moving
 * the pointer over it drops a ripple at the cursor: the dots around it are
 * pushed outward along the wave and eased back as the ring expands and fades,
 * and each ripple draws a soft ring that spreads exactly like a stone in water.
 * The interaction is the whole effect — no physics claim, no number, nothing a
 * student is asked to read.
 *
 * The loop honours prefers-reduced-motion (one static frame of dots), pauses
 * while the hero is off-screen or the tab is hidden, and draws in CSS pixels on
 * a DPR-scaled canvas.
 */
export function HeroRipple() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (host === null || canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches

    const DOT_STEP = 26
    const DOT_RADIUS = 1.15
    const RIPPLE_LIFE = 1100
    const RIPPLE_SPEED = 2.1
    const PUSH_RADIUS = 150
    const MAX_PUSH = 5.5

    interface Dot {
      x: number
      y: number
      /** Current eased offset from the resting position. */
      ox: number
      oy: number
    }
    interface Ripple {
      x: number
      y: number
      born: number
    }

    let width = 0
    let height = 0
    let dpr = 1
    let dots: Dot[] = []
    const ripples: Ripple[] = []
    let frame = 0
    let last = 0
    let visible = true
    let hidden = document.visibilityState === 'hidden'

    const buildDots = () => {
      dots = []
      for (let x = DOT_STEP / 2; x < width; x += DOT_STEP) {
        for (let y = DOT_STEP / 2; y < height; y += DOT_STEP) {
          dots.push({ x, y, ox: 0, oy: 0 })
        }
      }
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
      buildDots()
    }

    /* One wave pass: every dot feels every ripple. Each ripple pushes dots away
       from its centre with a gaussian falloff, and the ring's crest (a soft
       peak at its current radius) adds a little extra kick so the wave visibly
       travels. Dots ease back to rest when nothing is pushing them. */
    const step = (now: number) => {
      const active = ripples.filter(ripple => now - ripple.born < RIPPLE_LIFE)
      ripples.length = 0
      ripples.push(...active)

      for (const dot of dots) {
        let pushX = 0
        let pushY = 0
        for (const ripple of ripples) {
          const dx = dot.x - ripple.x
          const dy = dot.y - ripple.y
          const d = Math.hypot(dx, dy)
          if (d > PUSH_RADIUS || d < 1e-6) continue
          const age = now - ripple.born
          const life = age / RIPPLE_LIFE
          /* Gaussian falloff from the centre, fading with age. */
          const falloff = Math.exp(-(d * d) / (PUSH_RADIUS * PUSH_RADIUS * 0.32))
          const fade = 1 - life * life
          const magnitude = MAX_PUSH * falloff * fade
          const ux = dx / d
          const uy = dy / d
          pushX += ux * magnitude
          pushY += uy * magnitude
        }
        /* Ease back to rest when nothing pushes. */
        dot.ox += (pushX - dot.ox) * 0.16
        dot.oy += (pushY - dot.oy) * 0.16
      }
    }

    const draw = (now: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      /* Spreading ripple rings, drawn under the dots so they read as water. */
      for (const ripple of ripples) {
        const age = now - ripple.born
        const life = age / RIPPLE_LIFE
        if (life <= 0 || life >= 1) continue
        const radius = RIPPLE_SPEED * age
        context.beginPath()
        context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2)
        context.strokeStyle = `rgba(37, 99, 235, ${0.10 * (1 - life)})`
        context.lineWidth = 1
        context.stroke()
      }

      /* The lattice, displaced by the water. */
      for (const dot of dots) {
        const lit = Math.min(1, Math.hypot(dot.ox, dot.oy) / MAX_PUSH)
        context.beginPath()
        context.arc(dot.x + dot.ox, dot.y + dot.oy, DOT_RADIUS + lit * 0.5, 0, Math.PI * 2)
        context.fillStyle = `rgba(37, 99, 235, ${0.14 + lit * 0.12})`
        context.fill()
      }
    }

    const tick = (now: number) => {
      if (!visible || hidden) return
      if (last === 0) last = now
      step(now)
      draw(now)
      last = now
      frame = requestAnimationFrame(tick)
    }

    const start = () => {
      if (reduceMotion) {
        /* One calm frame — the lattice without the water. */
        draw(performance.now())
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

    const onMove = (event: PointerEvent) => {
      if (reduceMotion) return
      const rect = host.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      /* The host is pointer-events: none (it must never block the hero), so the
         pointer is tracked globally and projected into the host box. */
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
      /* Throttle: one ripple per few pixels of travel keeps the surface calm. */
      const lastRipple = ripples[ripples.length - 1]
      if (
        lastRipple !== undefined &&
        Math.hypot(x - lastRipple.x, y - lastRipple.y) < DOT_STEP * 0.9
      ) {
        return
      }
      ripples.push({ x, y, born: performance.now() })
      if (ripples.length > 48) ripples.splice(0, ripples.length - 48)
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

    window.addEventListener('pointermove', onMove)

    return () => {
      stop()
      resize?.disconnect()
      intersection?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  return (
    <div ref={hostRef} className={css.root} aria-hidden="true">
      <canvas ref={canvasRef} className={css.canvas} />
    </div>
  )
}
