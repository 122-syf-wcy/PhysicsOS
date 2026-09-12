import { useEffect, useRef } from 'react'
import css from './HomeAtmosphere.module.css'

/**
 * Light physics atmosphere behind the Home hero. Decorative only.
 *
 * Two layers: the static grid / orbit / formula SVG that stretches past the
 * stage's top edge (the "hero frame"), and a large soft blue glow that follows
 * the pointer — the same ambient-light trick the DeepSeek landing page uses, so
 * the frame feels alive without ever competing with the copy. The glow eases
 * toward the cursor instead of snapping, and freezes in place under
 * prefers-reduced-motion (the static SVG stays).
 */
export function HomeAtmosphere() {
  const hostRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const glow = glowRef.current
    if (host === null || glow === null) return

    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    /* Pointer position in fractions of the host box; the glow eases toward it.
       Default to a calm spot near the orbit so it is not parked at the corner. */
    let targetX = 0.3
    let targetY = 0.35
    let currentX = targetX
    let currentY = targetY
    let boxWidth = 0
    let boxHeight = 0
    let frame = 0

    const measure = () => {
      const rect = host.getBoundingClientRect()
      boxWidth = rect.width
      boxHeight = rect.height
    }

    const onMove = (event: PointerEvent) => {
      if (boxWidth < 2 || boxHeight < 2) return
      const rect = host.getBoundingClientRect()
      targetX = (event.clientX - rect.left) / boxWidth
      targetY = (event.clientY - rect.top) / boxHeight
    }

    const tick = () => {
      /* Exponential ease: the glow lags just enough to feel physical. */
      const ease = 0.075
      currentX += (targetX - currentX) * ease
      currentY += (targetY - currentY) * ease
      /* The glow is anchored at 50%/50%, so the translate is the pixel offset
         from the host centre to the eased cursor position. */
      glow.style.transform =
        `translate3d(${(currentX - 0.5) * boxWidth}px, ${(currentY - 0.5) * boxHeight}px, 0)`
      frame = requestAnimationFrame(tick)
    }

    measure()
    /* The host itself is pointer-events: none (it must never block the hero),
       so the pointer is tracked globally and projected into the host box. */
    window.addEventListener('pointermove', onMove)
    frame = requestAnimationFrame(tick)
    const resize = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure)
    resize?.observe(host)

    return () => {
      window.removeEventListener('pointermove', onMove)
      resize?.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={hostRef} className={css.root} aria-hidden="true">
      <svg
        className={css.static}
        viewBox="0 0 960 640"
        fill="none"
        focusable="false"
      >
        <defs>
          <pattern id="pos-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            {/* fill="none" is load-bearing: an SVG path defaults to a black fill,
                and an L-shaped grid cell filled black tiles into a checkerboard. */}
            <path d="M32 0H0V32" fill="none" stroke="rgba(37, 99, 235, 0.045)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="960" height="640" fill="url(#pos-grid)" />
        <circle cx="168" cy="148" r="92" stroke="rgba(37, 99, 235, 0.07)" strokeWidth="1" />
        <circle cx="168" cy="148" r="58" stroke="rgba(37, 99, 235, 0.05)" strokeWidth="1" />
        <circle cx="168" cy="148" r="3" fill="rgba(37, 99, 235, 0.12)" />
        <g fill="rgba(37, 99, 235, 0.09)" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="13">
          <text x="118" y="86">×</text>
          <text x="206" y="78">·</text>
          <text x="248" y="132">×</text>
          <text x="92" y="168">·</text>
          <text x="214" y="198">×</text>
          <text x="788" y="92">·</text>
          <text x="836" y="148">×</text>
          <text x="764" y="188">·</text>
        </g>
        <g
          fill="rgba(37, 99, 235, 0.11)"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="12"
        >
          <text x="72" y="560">F = qv × B</text>
          <text x="748" y="560">r = mv / qB</text>
        </g>
      </svg>
      {/* The pointer-following glow, painted over the static frame. Centred on
          the cursor with a soft falloff — DeepSeek-style ambient light. */}
      <div ref={glowRef} className={css.glow} />
    </div>
  )
}
