#!/usr/bin/env node
/**
 * Experiment-card illustration generator (gpt-image-2, 2K).
 *
 * One raster illustration per experiment template for the library home cards,
 * in a single shared visual language (Apple learning-centre: soft studio light,
 * one pastel field per subject, minimal apparatus, no text). Reads the provider
 * from the same `.env` keys as generate-physics-assets.mjs and writes 2048x2048
 * PNG + provenance JSON into UI/generated/experiment-art/.
 *
 * The gateway currently forwards /v1/images/generations to an ASYNC upstream
 * that answers with a task stub, while its own async endpoints (which would
 * make that stub pollable via /v1/images/tasks/{id}) are disabled until object
 * storage is configured server-side. This script therefore tries, in order:
 *   1. POST /v1/images/generations/async  (the gateway's own async pipeline)
 *   2. POST /v1/images/generations        (sync; also detects task stubs)
 * and polls /v1/images/tasks/{task_id} whenever it holds a pollable task. When
 * every route dead-ends it prints the exact server-side blocker and exits 1,
 * so re-running after the gateway fix is the only step needed.
 *
 * Usage:
 *   node scripts/design/generate-experiment-art.mjs --list
 *   node scripts/design/generate-experiment-art.mjs --all
 *   node scripts/design/generate-experiment-art.mjs magnetic-circular incline
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT_DIR = path.join(ROOT, 'UI', 'generated', 'experiment-art')
const SIZE = '2048x2048'

/* ------------------------------------------------------------------ env ---- */

const loadDotEnv = () => {
  const file = path.join(ROOT, '.env')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    process.env[key] = line.slice(eq + 1).trim()
  }
}

loadDotEnv()

const BASE = (process.env.PHYSICSOS_IMAGE_PRIMARY_BASE_URL ?? '').replace(/\/+$/, '')
const KEY = process.env.PHYSICSOS_IMAGE_PRIMARY_API_KEY ?? ''
const MODEL = process.env.PHYSICSOS_IMAGE_PRIMARY_MODEL ?? 'gpt-image-2'

/** Credentials are only needed to generate, not to list templates. */
const assertCredentials = () => {
  if (BASE === '' || KEY === '') {
    process.stderr.write('Set PHYSICSOS_IMAGE_PRIMARY_BASE_URL / _API_KEY in .env first.\n')
    process.exit(1)
  }
}

/* -------------------------------------------------------------- prompts ---- */

/**
 * One shared style so seventeen independent generations read as one set. The
 * palette lines up with the UI subject tokens (chrome.ts): mechanics slate-blue,
 * electric amber, magnetic violet, composite teal.
 */
const STYLE = `Minimal educational physics illustration in a premium Apple learning-app style.
Soft even studio light, gentle top-left key light, very subtle grain-free gradients.
One single centered subject built from simple rounded 3D forms, floating over a calm pastel field with a faint horizon.
Flat pastel background occupying the whole frame, generous negative space around the subject.
Clean vector-like surfaces, matte materials, restrained soft shadows directly beneath objects.
Strictly no text, no letters, no numbers, no labels, no UI, no people, no cartoon faces, no outlines, no neon, no clutter.`

const PALETTE = {
  mechanics: 'Palette: soft slate-blue and ice-blue pastels with white; accents in deep ink blue.',
  electric: 'Palette: warm amber and soft cream pastels with white; accents in deep honey gold.',
  magnetic: 'Palette: soft violet and lilac pastels with white; accents in deep plum.',
  composite: 'Palette: calm teal and mint pastels with white; accents in deep pine green.',
  optics: 'Palette: airy cyan and pale glass pastels with white; accents in deep sapphire.',
  thermal: 'Palette: warm coral and peach pastels with white; accents in deep terracotta.',
  fluid: 'Palette: aqua and powder-blue pastels with white; accents in deep ocean blue.',
  wave: 'Palette: periwinkle and lavender pastels with white; accents in deep indigo.',
  circuit: 'Palette: honey and cream pastels with white; accents in warm bronze.',
  acoustics: 'Palette: soft sea-blue and foam pastels with white; accents in deep slate teal.',
  induction: 'Palette: dusty denim-blue and silver pastels with white; accents in deep navy.',
}

/** subject → what the miniature scene shows (mirrors the SVG artwork motifs). */
const ASSETS = {
  'circular-orbit': [
    'mechanics',
    'A small glossy sphere held in a clean circular orbit around a larger matte sphere on a calm pastel surface, one slim arrow following the circle and one pointing straight inward toward the larger sphere.',
  ],
  'uniform-linear': [
    'mechanics',
    'A small glossy sphere gliding along a straight horizontal track, four evenly spaced ghost copies fading behind it, one slim arrow pointing forward.',
  ],
  'uniform-acceleration': [
    'mechanics',
    'A small glossy sphere on a straight horizontal track with ghost copies spaced progressively wider apart, one slim forward arrow growing longer.',
  ],
  'projectile-horizontal': [
    'mechanics',
    'A tiny sphere launched horizontally off the edge of a minimal elevated platform, following a smooth dotted parabolic arc down to the ground.',
  ],
  'projectile-oblique': [
    'mechanics',
    'A tiny sphere thrown upward at an angle, tracing one clean dotted parabolic arch over a flat ground line, apex clearly visible.',
  ],
  'newton-second-law': [
    'mechanics',
    'A rounded cube block on a smooth surface being pushed by one bold horizontal arrow, a second thinner arrow above showing acceleration.',
  ],
  'mechanical-energy': [
    'mechanics',
    'A small rounded cube resting at the top of a smooth diagonal ramp, a faint dotted line marking its drop straight down to the base, one soft wide arrow following the slope.',
  ],
  'ramp-friction': [
    'mechanics',
    'A small rounded cube sliding down a diagonally textured ramp, a thin dotted vertical line from its start down to the base, a few soft warm wisps rising from the surface behind it.',
  ],
  incline: [
    'mechanics',
    'A rounded cube block resting on a smooth wedge-shaped inclined plane, two slim arrows showing gravity straight down and support perpendicular to the slope.',
  ],
  'point-charge': [
    'electric',
    'A single glowing marble at the center with slim arrows radiating outward evenly in all directions, one faint dotted circle around it.',
  ],
  'multi-point-charge': [
    'electric',
    'Two glowing marbles side by side with smooth curved field lines arcing from one to the other, symmetric and calm.',
  ],
  'uniform-electric': [
    'electric',
    'A tiny charged marble drifting inside a faint dotted circular region, one slim arrow showing its deflected path.',
  ],
  'parallel-plate': [
    'electric',
    'Two long horizontal plates facing each other, slim arrows crossing the gap between them, a tiny sphere following a gentle curved path through.',
  ],
  'magnetic-circular': [
    'magnetic',
    'A tiny glowing sphere sweeping a perfect circular orbit, dotted orbit ring, small cross marks scattered softly in the background field.',
  ],
  'velocity-selector': [
    'composite',
    'A tiny sphere flying in a perfectly straight line through a rounded rectangular chamber, slim opposing arrows above and below balancing it.',
  ],
  'mass-spectrometer': [
    'composite',
    'A tiny sphere entering through a narrow slit then curving through a clean half-circle arc onto a flat detector shelf.',
  ],
  'composite-eb': [
    'composite',
    'A tiny sphere weaving one smooth S-shaped path through a rounded chamber marked by faint arrows and soft cross marks.',
  ],
  'composite-ebg': [
    'composite',
    'A tiny sphere following a long gentle drifting curve through a tall rounded chamber, faint arrows and cross marks in the field.',
  ],
  'multi-region-field': [
    'composite',
    'A tiny sphere crossing three softly tinted vertical zones: straight, then a half-circle turn, then a gentle curve, one continuous path.',
  ],
  cyclotron: [
    'composite',
    'Two facing D-shaped half discs with a narrow gap, a tiny sphere spiraling outward from the center in a clean expanding spiral.',
  ],
  lab: [
    'mechanics',
    'A minimal rounded laboratory flask with a single dotted elliptical orbit ring tilted around it, one tiny sphere on the ring.',
  ],
  question: [
    'magnetic',
    'A minimal rounded sheet of paper with a folded corner, one smooth dotted trajectory arc lifting off the page into space.',
  ],

  /* ------------------------------------------------------- mechanics, rest -- */
  'average-speed': [
    'mechanics',
    'A small wheeled cart crossing three evenly spaced gate posts on a straight track, one tiny stopwatch floating above.',
  ],
  'lever-balance': [
    'mechanics',
    'A slim beam resting level on a small triangular fulcrum, one small cylinder weight hanging on each side.',
  ],
  'collision-elastic': [
    'mechanics',
    'Two glossy spheres on a slim air track about to touch, a soft motion ghost trailing the incoming sphere.',
  ],
  'collision-inelastic': [
    'mechanics',
    'Two glossy spheres on a slim air track just past contact, one slightly dented, short motion ghosts.',
  ],
  'collision-perfectly-inelastic': [
    'mechanics',
    'Two glossy spheres joined as one lump gliding on a slim air track, a shared motion ghost behind.',
  ],

  /* ------------------------------------ mechanics, P3-a reinforcements 批 --
     These ten templates were added after the first artwork pass and had been
     falling back to the inline SVG piece. Listed here so every card ships the
     same generated language. */
  'vt-area': [
    'mechanics',
    'A small wheeled cart on a straight track, one slim rising line drawn above it and the swept triangular region beneath the line softly shaded.',
  ],
  'force-composition': [
    'mechanics',
    'A single rounded block with two slim arrows leaving it at right angles and one longer arrow completing the diagonal.',
  ],
  'concurrent-equilibrium': [
    'mechanics',
    'Three slim taut cords meeting at one small ring, pulling outward evenly in three directions, a tiny knot at the center.',
  ],
  'apparent-weight': [
    'mechanics',
    'A rounded block resting on a round spring scale dial inside a minimal open lift frame, one slim arrow pointing straight up from the block.',
  ],
  'chase-meeting': [
    'mechanics',
    'Two small wheeled carts on two parallel straight lanes, the trailing one with longer motion ghosts, both level with each other.',
  ],
  'hooke-law': [
    'mechanics',
    'A slim coil spring hanging from a small bracket, one small cylinder weight hooked below, the coils stretched wider toward the bottom.',
  ],
  'spring-oscillator': [
    'mechanics',
    'A small block on a smooth horizontal rail attached to a slim coil spring at one end, short motion ghosts on both sides of its rest position.',
  ],
  'simple-pendulum': [
    'mechanics',
    'A small glossy bob on a slim cord swinging from a tiny clamp, two faint dotted arcs tracing its swing.',
  ],
  'friction-static': [
    'mechanics',
    'A rounded block resting on a textured flat surface with one slim arrow pushing it sideways and no motion ghost.',
  ],
  'friction-mu': [
    'mechanics',
    'A rounded block sliding along a textured flat surface, short motion ghosts trailing behind and one slim arrow showing the opposing drag.',
  ],

  /* -------------------------------------------------------------- optics -- */
  pinhole: [
    'optics',
    'A tall thin arrow standing on a calm pastel surface, a small card with a round hole in the middle some way behind it, and a shorter blurred-mirror arrow hanging upside down on a pale screen further back, two thin straight rays crossing exactly at the hole.',
  ],
  'total-reflection': [
    'optics',
    'A pale glass block filling the lower half of a calm pastel scene with a soft boundary line across the middle, one slim light beam striking the boundary and one equal beam leaving it back upward, a faint dotted beam continuing downward.',
  ],
  'plane-mirror': [
    'optics',
    'A small lit candle standing before a tall flat mirror panel, an identical soft candle image appearing behind the glass.',
  ],
  'convex-lens': [
    'optics',
    'A small candle left of a standing oval glass lens, two slim light rays converging to a tiny inverted image on the right.',
  ],
  'concave-mirror': [
    'optics',
    'A small candle before a dish-shaped concave mirror, two slim rays folding back to a tiny inverted image in front.',
  ],
  'convex-mirror': [
    'optics',
    'A small candle before a dome-shaped outward-curving mirror holding a tiny upright shrunken reflection.',
  ],

  /* ------------------------------------------------------------- thermal -- */
  thermometer: [
    'thermal',
    'A tall clear glass thermometer standing upright on a calm pastel surface, a warm red column of liquid rising partway up its narrow bore from a small round bulb at the base, two short ruled marks across the glass.',
  ],
  'boiling-water': [
    'thermal',
    'A clear glass beaker of gently steaming water on a calm pastel surface with three soft wisps of steam rising from the surface, a small round dial thermometer resting against the inside wall.',
  ],
  'crystal-melting': [
    'thermal',
    'A small glass beaker of ice cubes resting over a rounded heater with three tiny flames, a slim thermometer standing beside.',
  ],
  'heat-capacity-comparison': [
    'thermal',
    'Two small identical beakers side by side over two small heaters, their thermometers risen to different heights.',
  ],

  /* --------------------------------------------------------------- fluid -- */
  buoyancy: [
    'fluid',
    'A small cube hanging from a round spring scale dial, half-dipped into a glass tank of calm water.',
  ],
  'solid-pressure': [
    'fluid',
    'One rectangular block shown twice side by side: lying flat on its wide face on the left, standing on its narrow edge on the right, each with an identical short downward arrow above it.',
  ],
  'liquid-pressure': [
    'fluid',
    'A tall clear beaker of still water with two small round probe discs hanging inside at two different depths, each probe connected by a thin dotted vertical line up to the water surface.',
  ],
  'atmospheric-pressure': [
    'fluid',
    'A glass dish of silvery liquid with one tall narrow tube standing inverted in it, the tube filled partway up, beside a smooth sphere split into two halves pulling apart with a slim arrow on each side.',
  ],

  /* ------------------------------------------------------- current-magnetic -- */
  'straight-wire-field': [
    'magnetic',
    'A short glossy cylinder standing upright on a calm pastel surface, three flat concentric rings marked around its base on the surface, one small matte sphere resting on the middle ring.',
  ],
  'solenoid-field': [
    'magnetic',
    'A short glossy helix of copper-colored wire lying horizontally on a calm pastel surface, a slim straight rod running through its centre, two soft dotted arcs curving out from one end and back into the other.',
  ],
  electromagnet: [
    'magnetic',
    'A smooth grey iron rod passing lengthwise through a short glossy copper helix, a small matte grey block clinging to the rod tip, two soft dotted arcs curving out from one end and back into the other.',
  ],
  motor: [
    'magnetic',
    'A single square loop of copper wire standing upright between two pale horizontal field bands, one slim arrow rising from the left side of the loop and an equal one descending from the right side.',
  ],

  /* ---------------------------------------------------------------- wave -- */
  'wave-travelling': [
    'wave',
    'A taut cord leaving a small driver box on the left, carrying one smooth travelling sine wave to the right.',
  ],
  'wave-interference': [
    'wave',
    'Two small round dippers touching a flat water surface, two overlapping families of concentric circular ripples.',
  ],
  'wave-standing': [
    'wave',
    'A taut string clamped between two small posts, shaped into a smooth two-hump standing wave with a faint envelope.',
  ],

  /* ------------------------------------------------------------- circuit -- */
  'short-circuit': [
    'circuit',
    'A simple closed rectangular loop of pale wire on a calm pastel surface with a small battery block at the bottom left and a round dial meter at the bottom right, no other parts anywhere along the wire.',
  ],
  'series-circuit': [
    'circuit',
    'A small rounded battery and two tiny glowing bulbs joined by one single smooth looping wire.',
  ],
  'parallel-circuit': [
    'circuit',
    'A small rounded battery feeding two side-by-side branches each holding a tiny bulb, wires splitting and rejoining.',
  ],
  'mixed-circuit': [
    'circuit',
    'A small battery with one tiny bulb in line and two more bulbs sharing a forked branch, wires forming a compact loop.',
  ],
  'rheostat-circuit': [
    'circuit',
    'A small battery, a tiny bulb and a sliding-contact resistor bar wired in one loop, the slider mid-travel.',
  ],
  'va-resistance': [
    'circuit',
    'A small battery, a slim resistor cylinder and two tiny round meter dials joined by a single wire loop.',
  ],
  'bulb-power': [
    'circuit',
    'A small battery and one tiny bulb glowing with a soft halo on a simple wire loop.',
  ],
  'emf-measurement': [
    'circuit',
    'A small battery wired to a round voltmeter dial and a tiny bulb, the needle sitting mid-scale.',
  ],

  /* ----------------------------------------------------------- acoustics -- */
  noise: [
    'acoustics',
    'A small round dark speaker on the left of a calm pastel surface with three soft concentric arcs spreading to the right, a pale upright flat panel standing in their path and a small round marker beyond it.',
  ],
  'echo-ranging': [
    'acoustics',
    'A tiny rounded loudspeaker on a small tripod facing a tall soft cliff, two dotted sound arcs travelling out and back.',
  ],

  /* ----------------------------------------------------------- induction -- */
  transformer: [
    'induction',
    'A smooth grey rectangular core bar lying flat on a calm pastel surface with a dense coil of copper wire wound around its left half and a smaller copper coil around its right half.',
  ],
  'induction-bar-motion': [
    'induction',
    'Two parallel metal rails with a small bar sliding across them through a dotted field zone, joined at one end by a tiny resistor.',
  ],
  'induction-double-bar-momentum': [
    'induction',
    'Two parallel metal rails carrying two small bars drifting toward each other through a faint dotted field.',
  ],
  'induction-double-bar-force': [
    'induction',
    'Two parallel metal rails with two small bars, one pushed by a slim horizontal arrow, faint field dots.',
  ],
  'induction-flux-change': [
    'induction',
    'A small wire coil ring with a tiny bar magnet sliding through it, a small round meter dial beside.',
  ],
}

/* ----------------------------------------------------------------- http ---- */

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const call = async (pathname, init = {}, timeoutMs = 300_000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      /* html or empty */
    }
    return { status: response.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

/** Poll the gateway's image-task route until the task settles or time runs out. */
const pollTask = async (taskId, budgetMs = 600_000) => {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    await sleep(5000)
    const { status, json } = await call(`/v1/images/tasks/${taskId}`, {}, 30_000)
    if (status === 404)
      return { failed: `task not pollable on this gateway (404 ${json?.error?.code ?? ''})` }
    if (json?.status === 'failed') return { failed: json?.error?.message ?? 'task failed' }
    if (json?.status === 'completed')
      return { item: json?.result?.data?.[0] ?? { url: json?.image_url } }
  }
  return { failed: 'poll budget exhausted' }
}

const downloadBytes = async (item) => {
  if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
    return Buffer.from(item.b64_json, 'base64')
  }
  if (typeof item?.url === 'string' && item.url.length > 0) {
    const response = await fetch(item.url)
    if (!response.ok) throw new Error(`download HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
  throw new Error('result carried neither b64_json nor url')
}

/* ------------------------------------------------------------- generate ---- */

const generate = async (id) => {
  const [domain, subject] = ASSETS[id]
  const prompt = `${STYLE}\n${PALETTE[domain]}\nSubject: ${subject}`
  const body = JSON.stringify({ model: MODEL, prompt, n: 1, size: SIZE })
  process.stdout.write(`\u00b7 ${id} (${domain}) \u2026\n`)

  /* Route 1: the gateway's own async pipeline (disabled until object storage
     is configured server-side; costs nothing to try and self-heals the day
     the operator flips it on). */
  const asyncSubmit = await call('/v1/images/generations/async', { method: 'POST', body }, 60_000)
  let item
  if (asyncSubmit.status === 202 && typeof asyncSubmit.json?.task_id === 'string') {
    const settled = await pollTask(asyncSubmit.json.task_id)
    if (settled.failed !== undefined) throw new Error(`async route: ${settled.failed}`)
    item = settled.item
  } else {
    /* Route 2: the sync endpoint. Either a real result, or a passthrough task
       stub from the async upstream (data.task_id) that no exposed route can
       poll — try the task route anyway, then report the blocker. */
    const sync = await call('/v1/images/generations', { method: 'POST', body })
    item = sync.json?.data?.[0]
    const stub = sync.json?.data?.task_id ?? sync.json?.task_id
    if (item === undefined && typeof stub === 'string') {
      const settled = await pollTask(stub, 120_000)
      if (settled.failed !== undefined) {
        throw new Error(
          `gateway returned upstream task stub ${stub}; ${settled.failed}. ` +
            'Server-side fix: enable async image object storage (Admin \u2192 Backup) ' +
            'or point the model at a synchronous upstream channel.',
        )
      }
      item = settled.item
    }
    if (item === undefined) {
      throw new Error(`unexpected response (HTTP ${sync.status}): ${sync.text.slice(0, 160)}`)
    }
  }

  const bytes = await downloadBytes(item)
  mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${id}.png`)
  writeFileSync(file, bytes)
  writeFileSync(
    path.join(OUT_DIR, `${id}.json`),
    `${JSON.stringify(
      {
        asset: id,
        domain,
        model: MODEL,
        requested: SIZE,
        bytes: bytes.length,
        prompt,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(
    `  \u2713 ${path.relative(ROOT, file)}  ${(bytes.length / 1024).toFixed(0)} KiB\n`,
  )
}

/* ----------------------------------------------------------------- main ---- */

const argv = process.argv.slice(2)
if (argv.includes('--list') || argv.length === 0) {
  for (const [id, [domain]] of Object.entries(ASSETS)) {
    process.stdout.write(`  ${id.padEnd(24)} ${domain}\n`)
  }
  process.stdout.write('\nRun with --all or pass template ids.\n')
  process.exit(0)
}

const ids = argv.includes('--all')
  ? Object.keys(ASSETS)
  : argv.filter((arg) => !arg.startsWith('--'))
const unknown = ids.filter((id) => ASSETS[id] === undefined)
if (unknown.length > 0) {
  process.stderr.write(`Unknown template ids: ${unknown.join(', ')}\n`)
  process.exit(1)
}

assertCredentials()

let failed = 0
for (const id of ids) {
  try {
    await generate(id)
  } catch (error) {
    failed += 1
    process.stdout.write(
      `  \u2717 ${id}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
}
process.stdout.write(`\n${ids.length - failed} generated, ${failed} failed.\n`)
if (failed > 0) process.exitCode = 1
