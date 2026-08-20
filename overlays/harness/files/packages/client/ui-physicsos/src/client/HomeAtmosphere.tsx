import css from './HomeAtmosphere.module.css'

/** Very light physics atmosphere behind the Home hero. Decorative only. */
export function HomeAtmosphere() {
  return (
    <svg
      className={css.root}
      viewBox="0 0 960 640"
      fill="none"
      aria-hidden="true"
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
  )
}
