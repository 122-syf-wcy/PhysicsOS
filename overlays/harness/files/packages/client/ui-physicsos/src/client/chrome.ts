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
  --physics-vector-spring: #b06f2e;
  --physics-vector-tension: #7c6bd9;
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
  /* Canvas ink stays paired with the fixed light canvas, including dark hosts. */
  --physics-canvas-text: #24364b;
  --physics-canvas-text-muted: #52677e;
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

  /* ---------- acoustics ----------
     Sound is sky blue: the travelling pulse solid, its trailing wavefront arcs
     and the out/return path guides in the soft shade. */
  --physics-acoustics-wave: #0284c7;
  --physics-acoustics-wave-soft: #7cc3e8;

  /* ---------- fluid statics ----------
     Water is teal so it never reads as the sky-blue sound pulse: the liquid
     body and the submerged slab in the solid shade, the surface line soft. */
  --physics-fluid-liquid: #0d9488;
  --physics-fluid-liquid-soft: #cdeeea;

  /* ---------- thermal ----------
     Heat is warm red: the thermometer column, the flames and the melting-point
     line. Solid and melted sample are two steps of the same warm neutral, so
     the phase change reads without competing with the heat colour. */
  --physics-thermal-heat: #dc2626;
  --physics-thermal-solid: #dbe6f0;
  --physics-thermal-liquid: #a8c8e4;

  /* ---------- induction ----------
     Induction ink is indigo — distinct from the violet subject chip of
     magnetism (its parent subject) so a bench rod never reads as a particle
     orbit: the field marks soft, the rod and coil solid, the induced current
     amber-warm like the optics rays it shares "energy flowing" semantics with. */
  --physics-induction-field: #8b9dc9;
  --physics-induction-rod: #4338ca;
  --physics-induction-current: #d97706;
  /* The core of an electromagnet is neither the winding nor the field: iron has
     to read as a third material on the same bench, between the copper it is
     threaded through and the field lines that pass across it. */
  --physics-magnetic-core: #94a3b8;

  /* ---------- wave ----------
     Wave ink is rose — no other domain uses it, so a rope profile is never
     mistaken for a trajectory (blue) or a field (violet/indigo). The profile
     and the sources take the full tone, the envelope and spreading crests a
     pale tint, the equilibrium rule stays neutral slate, and the marked
     particle borrows the sky of the acoustics pulse so the eye finds the one
     point that does NOT travel with the wave. */
  --physics-wave-rope: #be185d;
  --physics-wave-envelope: #f9a8d4;
  --physics-wave-front: #f472b6;
  --physics-wave-equilibrium: #94a3b8;
  --physics-wave-node: #334155;
  --physics-wave-marker: #0284c7;

  /* ---------- circuit ----------
     Current is energy in motion, so it borrows the warm gold the induction
     current and the optics rays already carry — but as its own token, because
     the flowing dash layer must be tunable without dragging those with it. The
     conductor is a cable rather than a hairline: a dark body with a cool sheen
     so the gold beads read against it. Lamp light is three steps of one warm
     ramp (core → hot → bloom) because a single flat halo is exactly what made
     the bulbs read as stickers. */
  --physics-wire: #31363f;
  --physics-wire-sheen: #7b8698;
  --physics-current-flow: #ffe08a;
  --physics-current-flow-glow: rgb(120 70 0 / 55%);
  --physics-lamp-core: #fff8e6;
  --physics-lamp-hot: #ffd166;
  --physics-lamp-bloom: #ff9d2e;

  /* ---------- status ---------- */
  --physics-verification-ok: #2f9e5a;
  --physics-verification-warning: #d97706;
  --physics-verification-error: #c2413a;

  /* ---------- subjects ----------
     Library / navigation identity for the experiment domains (力学 / 电场 / 磁场 /
     电路 / 复合场 / 光学 / 声学 / 浮力 / 热学), one hue + one tinted surface each.
     These colour UI chrome — picker cards, tags, tabs — NEVER canvas physics: a
     vector keeps its vector token even inside a subject-tinted card. */
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
  --physics-subject-acoustics: #0284c7;
  --physics-subject-acoustics-tint: #e3f2fb;
  --physics-subject-fluid: #0891b2;
  --physics-subject-fluid-tint: #dff4f8;
  --physics-subject-thermal: #dc2626;
  --physics-subject-thermal-tint: #fbe3e3;
  --physics-subject-induction: #4338ca;
  --physics-subject-induction-tint: #e8e8fb;
  --physics-subject-wave: #db2777;
  --physics-subject-wave-tint: #fce7f3;

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

  /* ---------- surfaces ----------
     The glass material is shared by every floating panel (cards, palette,
     inspector, composer). The desk itself is bound on body below, because its
     source token lives there. The canvas tokens above stay fixed-light on
     purpose: the physics inks are tuned against a white sheet, so a dark host
     keeps the sheet and darkens only the desk and the panels around it. */
  --physics-glass-fill: rgba(255, 255, 255, 0.68);
  --physics-glass-fill-strong: rgba(255, 255, 255, 0.82);
  --physics-glass-border: rgba(255, 255, 255, 0.84);
  --physics-glass-border-soft: rgba(148, 173, 199, 0.34);
  --physics-glass-shadow: 0 16px 36px rgba(65, 93, 122, 0.1);
  --physics-glass-shadow-raised: 0 18px 42px rgba(65, 93, 122, 0.14);
  --physics-glass-inset: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --physics-glass-plate: #f7f9fc;

  /* Interaction tint: a pale wash of the meaning colour over the host's base
     surface. Written as a mix rather than a fixed pale hex so a dark host gets
     a deep tint instead of a near-white block, and the ink flips with it. */
  --physics-tint-accent: color-mix(in srgb, var(--dsw-static-blue-500) 12%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-accent-strong: color-mix(in srgb, var(--dsw-static-blue-500) 22%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-accent-ink: var(--dsw-static-blue-600);
  --physics-tint-verified: color-mix(in srgb, var(--physics-verification-ok) 12%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-warning: color-mix(in srgb, var(--physics-verification-warning) 14%, var(--dsw-alias-bg-base, #ffffff));
  --physics-tint-verified-edge: color-mix(in srgb, var(--physics-verification-ok) 38%, transparent);
  --physics-tint-warning-edge: color-mix(in srgb, var(--physics-verification-warning) 38%, transparent);

  /* ---------- ink ----------
     The physics tokens above colour physics; these colour words. Text needs its
     own layer because a surface can afford to sit near the background while a
     label cannot: the host's dimmed label resolves to a mid grey that is legible
     on a light desk and all but invisible on a dark one. Light values are the
     ink the product already used. */
  --physics-ink: #34506d;
  --physics-ink-strong: #23456b;
  --physics-ink-muted: var(--dsw-alias-label-dimmed, #6b7280);
  --physics-ink-link: #1d4ed8;
  --physics-ink-ok: #047857;
  --physics-ink-warn: #b45309;
  --physics-ink-mark: #be185d;
}

/* The host writes its alias palette onto body, so a surface token can only
   follow it from that same scope: defined on the root element the reference
   would resolve there, find nothing, and silently keep the light hex - a dark
   host would then sit on a white desk. */
body {
  --physics-workspace-bg: var(--dsw-alias-bg-base, #f3f6fa);
}

/* Dark host: the sheet stays, the desk and the panels go dark. */
body[data-ds-dark-theme] {
  --physics-glass-fill: rgba(35, 35, 36, 0.72);
  --physics-glass-fill-strong: rgba(44, 44, 46, 0.88);
  --physics-glass-border: rgba(255, 255, 255, 0.08);
  --physics-glass-border-soft: rgba(255, 255, 255, 0.14);
  --physics-glass-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
  --physics-glass-shadow-raised: 0 18px 42px rgba(0, 0, 0, 0.6);
  --physics-glass-inset: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --physics-glass-plate: var(--dsw-alias-bg-layer-2, #2c2c2e);
  --physics-tint-accent-ink: var(--dsw-static-blue-300, #93c5fd);

  /* Ink flips to the light end of each hue: the same words sit on a near-black
     desk now, so a hue that read as "deep" on white reads as "invisible" here. */
  --physics-ink: #cbd6e4;
  --physics-ink-strong: #e2e8f0;
  --physics-ink-muted: var(--dsw-alias-label-secondary, #a3aab4);
  --physics-ink-link: var(--dsw-static-blue-300, #93c5fd);
  --physics-ink-ok: var(--dsw-static-green-400, #4ed17e);
  --physics-ink-warn: var(--dsw-static-amber-400, #f7ad31);
  --physics-ink-mark: #f9a8d4;
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

body[data-ds-dark-theme] {
  --dsh-scrollbar-thumb: rgba(255, 255, 255, 0.18);
  --dsh-scrollbar-thumb-hover: rgba(255, 255, 255, 0.3);
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
