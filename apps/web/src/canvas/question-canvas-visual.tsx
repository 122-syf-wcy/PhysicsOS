export function QuestionCanvasVisual() {
  return (
    <svg viewBox="0 0 720 360" className="h-full w-full" role="img" aria-label="试题可视化画布">
      <rect width="720" height="360" fill="var(--bg-canvas)" />
      <g stroke="var(--physics-grid-major)" strokeWidth="1">
        <line x1="40" y1="320" x2="680" y2="320" />
        <line x1="40" y1="320" x2="40" y2="24" />
      </g>
      {Array.from({ length: 8 }, (_, i) => (
        <text key={i} x={120 + i * 60} y={80 + (i % 3) * 70} fill="#9db4d4" fontSize="14">
          ×
        </text>
      ))}
      <path
        d="M 160 220 A 90 90 0 0 1 340 220"
        fill="none"
        stroke="var(--physics-trajectory)"
        strokeWidth="2.4"
      />
      <circle cx="250" cy="132" r="8" fill="#3b82f6" />
      <text x="56" y="40" fontSize="12" fill="var(--text-tertiary)">
        x y z
      </text>
    </svg>
  )
}
