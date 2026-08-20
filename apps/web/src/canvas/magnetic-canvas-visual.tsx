/**
 * PHASE-01 visual shell only.
 * Positions come from prototype display constants, not Physics Engine formulas.
 */
const VISUAL = {
  radiusRatio: 0.28,
  angle: Math.PI * 1.015,
} as const

export function MagneticCanvasVisual() {
  const width = 920
  const height = 520
  const cx = width * 0.48
  const cy = height * 0.52
  const r = Math.min(width, height) * VISUAL.radiusRatio
  const px = cx + r * Math.cos(VISUAL.angle)
  const py = cy + r * Math.sin(VISUAL.angle)
  const tx = -Math.sin(VISUAL.angle)
  const ty = Math.cos(VISUAL.angle)

  const glyphs = Array.from({ length: 11 }, (_, ix) =>
    Array.from({ length: 7 }, (_, iy) => ({
      x: 90 + ix * 70,
      y: 70 + iy * 58,
    })),
  ).flat()

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="磁场中带电粒子运动画布">
      <defs>
        <pattern id="minor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--physics-grid-minor)" strokeWidth="1" />
        </pattern>
        <pattern id="major-grid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M 80 0 L 0 0 0 80" fill="none" stroke="var(--physics-grid-major)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="var(--bg-canvas)" />
      <rect width={width} height={height} fill="url(#minor-grid)" />
      <rect width={width} height={height} fill="url(#major-grid)" />
      <line x1="48" y1={height - 36} x2={width - 24} y2={height - 36} stroke="var(--physics-axis)" />
      <line x1="48" y1={height - 36} x2="48" y2="24" stroke="var(--physics-axis)" />
      <text x={width - 28} y={height - 42} fontSize="12" fill="var(--physics-axis)">
        x / cm
      </text>
      <text x="56" y="28" fontSize="12" fill="var(--physics-axis)">
        y / cm
      </text>
      {glyphs.map((g) => (
        <text key={`${g.x}-${g.y}`} x={g.x} y={g.y} fontSize="13" fill="#9db4d4" textAnchor="middle">
          ×
        </text>
      ))}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--physics-trajectory)"
        strokeDasharray="7 6"
        strokeWidth="2"
      />
      <circle cx={px} cy={py} r="7" fill="#e95b54" />
      <line
        x1={px}
        y1={py}
        x2={px + tx * 54}
        y2={py + ty * 54}
        stroke="var(--physics-velocity)"
        strokeWidth="2.2"
        markerEnd="url(#arrow-v)"
      />
      <line
        x1={px}
        y1={py}
        x2={px - (px - cx) * 0.35}
        y2={py - (py - cy) * 0.35}
        stroke="var(--physics-force)"
        strokeWidth="2.2"
      />
      <defs>
        <marker id="arrow-v" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--physics-velocity)" />
        </marker>
      </defs>
      <text x={px + 16} y={py - 16} fontSize="13" fill="var(--physics-velocity)">
        v₀
      </text>
      <text x={cx - 8} y={cy + 6} fontSize="13" fill="var(--physics-force)">
        F = qv × B
      </text>
    </svg>
  )
}
