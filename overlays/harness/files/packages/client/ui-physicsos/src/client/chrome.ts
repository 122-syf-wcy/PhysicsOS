/**
 * Document-level PhysicsOS chrome: physics semantic tokens, focus ring, thin
 * scrollbar.
 *
 * The physics tokens MUST be installed at document level, not imported as a
 * stylesheet: a plugin bundle only auto-injects `*.module.css`, so a plain
 * `physics-tokens.css` import would silently never load — and an undefined
 * `var(--physics-*)` on `stroke`/`fill` reverts to the inherited value, which is
 * `none` under the canvas's `<svg fill="none">`. That failure mode paints an
 * entirely blank physics canvas, so `tests/chrome.client.spec.ts` asserts these
 * resolve.
 */

/* PhysicsOS physics semantic tokens.

   These map onto the Harness --dsw-* system rather than starting a second design
   system. A renderer or panel must reference a --physics-* token, never a raw
   hex, so a colour has one meaning across the whole product:

     velocity      green      motion happening now
     force         physics blue / deep blue
     acceleration  amber      rate of change
     trajectory    cobalt     the path itself
     gravity       slate blue an always-present background force
     measurement   grey       construction, not physics
     verification  green      a check that passed

   Colour is a physical statement here, so it is deliberately narrow: adding a
   hue means adding a physical meaning. */
const PHYSICS_TOKENS = `
:root {
  /* ---------- vectors ---------- */
  --physics-vector-velocity: #2f9e5a;
  --physics-vector-velocity-soft: #7cc59a;
  --physics-vector-force: #2563eb;
  --physics-vector-force-soft: #93b8f5;
  --physics-vector-electric-force: #2563eb;
  --physics-vector-magnetic-force: #3b5bdb;
  --physics-vector-acceleration: #d97706;
  --physics-vector-acceleration-soft: #f0b775;
  --physics-vector-gravity: #475f8a;
  --physics-vector-normal: #1d4ed8;
  --physics-vector-friction: #b4553f;
  --physics-vector-net-force: #1e40af;

  /* ---------- geometry ---------- */
  --physics-trajectory: #2563eb;
  --physics-trajectory-predicted: #9cbdf2;
  --physics-field: #7d93b8;
  --physics-measurement: #7c8ba5;
  --physics-measurement-soft: #b9c4d4;
  --physics-angle: #5b7bb8;

  /* ---------- surfaces ---------- */
  --physics-canvas-bg: #fbfdff;
  --physics-grid-minor: #e6eef9;
  --physics-grid-major: #d3e0f2;
  --physics-axis: #94a7c4;
  --physics-body-fill: #dce7f7;
  --physics-body-stroke: #33507f;
  --physics-body-live: #2563eb;
  --physics-surface-hatch: #b9c8de;
  --physics-incline-fill: #eef4fc;

  /* ---------- key points ---------- */
  --physics-keypoint-launch: #2f9e5a;
  --physics-keypoint-apex: #d97706;
  --physics-keypoint-impact: #c2413a;

  /* ---------- optics ----------
     Light itself is warm amber; the computed image carries violet so "where the
     rays (or their extensions) meet" is findable against the amber paths. */
  --physics-optics-ray: #d97706;
  --physics-optics-ray-soft: #edba6f;
  --physics-optics-image: #7c3aed;

  /* ---------- status ---------- */
  --physics-verification-ok: #2f9e5a;
  --physics-verification-warning: #d97706;
  --physics-verification-error: #c2413a;

  /* ---------- subjects ----------
     Library / navigation identity for the experiment domains (力学 / 电场 / 磁场 /
     电路 / 复合场 / 光学), one hue + one tinted surface each. These colour UI
     chrome — picker cards, tags, tabs — NEVER canvas physics: a vector keeps its
     vector token even inside a subject-tinted card. */
  --physics-subject-mechanics: #2f9e5a;
  --physics-subject-mechanics-tint: #e7f4ec;
  --physics-subject-electric: #2563eb;
  --physics-subject-electric-tint: #e8effc;
  --physics-subject-magnetic: #7c3aed;
  --physics-subject-magnetic-tint: #f1ebfd;
  --physics-subject-circuit: #0d9488;
  --physics-subject-circuit-tint: #e2f4f1;
  --physics-subject-composite: #ea580c;
  --physics-subject-composite-tint: #fdeee3;
  --physics-subject-optics: #ca8a04;
  --physics-subject-optics-tint: #faf3d8;

  /* ---------- interaction ---------- */
  --physics-highlight: #f5a524;
  --physics-highlight-glow: rgba(245, 165, 36, 0.22);

  /* ---------- motion ----------
     Fast enough to read as direct response, never as a 500ms animation. */
  --physics-motion-fast: 120ms;
  --physics-motion-base: 150ms;
  --physics-motion-slow: 180ms;
  --physics-ease: cubic-bezier(0.2, 0, 0.13, 1);

  /* Entrance choreography (library home, cards easing in) runs longer than the
     response tokens above because it narrates layout, not physics: a decisive
     ease-out that lands still. Interactions keep using the fast tokens. */
  --physics-motion-entrance: 460ms;
  --physics-ease-emphasized: cubic-bezier(0.22, 1, 0.36, 1);
}

/* Physics time is never faked by a CSS tween; only presentation properties
   transition. A user who disables motion loses nothing physical. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --physics-motion-fast: 0ms;
    --physics-motion-base: 0ms;
    --physics-motion-slow: 0ms;
    --physics-motion-entrance: 0ms;
  }
}
`

const PHYSICSOS_CHROME_CSS = `${PHYSICS_TOKENS}
:root {
  --physicsos-focus: var(--dsw-static-blue-500, #3b82f6);
  --physics-workspace-bg: #f3f6fa;
  --physics-glass-fill: rgba(255, 255, 255, 0.68);
  --physics-glass-fill-strong: rgba(255, 255, 255, 0.82);
  --physics-glass-border: rgba(255, 255, 255, 0.84);
  --physics-glass-border-soft: rgba(148, 173, 199, 0.34);
  --physics-glass-shadow: 0 16px 36px rgba(65, 93, 122, 0.1);
}
*:focus {
  outline: none;
}
*:focus-visible {
  outline: 2px solid var(--physicsos-focus);
  outline-offset: 2px;
}
textarea:focus,
input:focus,
button:focus,
[role='button']:focus,
[role='menuitem']:focus {
  outline: none;
}
textarea:focus-visible,
input:focus-visible,
button:focus-visible,
[role='button']:focus-visible,
[role='menuitem']:focus-visible {
  outline: 2px solid var(--physicsos-focus);
  outline-offset: 2px;
}

body {
  --dsh-scrollbar-thumb: rgba(15, 23, 42, 0.16);
  --dsh-scrollbar-thumb-hover: rgba(15, 23, 42, 0.28);
  --dsh-scrollbar-width: 6px;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  border-radius: 999px;
}
`

/** Install PhysicsOS focus / scrollbar overrides for the Web Client lifetime. */
export function mountPhysicsOSChrome(): () => void {
  const previous = document.head.querySelector('style[data-physicsos-chrome]')
  previous?.remove()
  const style = document.createElement('style')
  style.setAttribute('data-physicsos-chrome', '')
  style.textContent = PHYSICSOS_CHROME_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
