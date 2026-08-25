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
}

/** subject → what the miniature scene shows (mirrors the SVG artwork motifs). */
const ASSETS = {
  'uniform-linear': ['mechanics', 'A small glossy sphere gliding along a straight horizontal track, four evenly spaced ghost copies fading behind it, one slim arrow pointing forward.'],
  'uniform-acceleration': ['mechanics', 'A small glossy sphere on a straight horizontal track with ghost copies spaced progressively wider apart, one slim forward arrow growing longer.'],
  'projectile-horizontal': ['mechanics', 'A tiny sphere launched horizontally off the edge of a minimal elevated platform, following a smooth dotted parabolic arc down to the ground.'],
  'projectile-oblique': ['mechanics', 'A tiny sphere thrown upward at an angle, tracing one clean dotted parabolic arch over a flat ground line, apex clearly visible.'],
  'newton-second-law': ['mechanics', 'A rounded cube block on a smooth surface being pushed by one bold horizontal arrow, a second thinner arrow above showing acceleration.'],
  incline: ['mechanics', 'A rounded cube block resting on a smooth wedge-shaped inclined plane, two slim arrows showing gravity straight down and support perpendicular to the slope.'],
  'point-charge': ['electric', 'A single glowing marble at the center with slim arrows radiating outward evenly in all directions, one faint dotted circle around it.'],
  'multi-point-charge': ['electric', 'Two glowing marbles side by side with smooth curved field lines arcing from one to the other, symmetric and calm.'],
  'uniform-electric': ['electric', 'A tiny charged marble drifting inside a faint dotted circular region, one slim arrow showing its deflected path.'],
  'parallel-plate': ['electric', 'Two long horizontal plates facing each other, slim arrows crossing the gap between them, a tiny sphere following a gentle curved path through.'],
  'magnetic-circular': ['magnetic', 'A tiny glowing sphere sweeping a perfect circular orbit, dotted orbit ring, small cross marks scattered softly in the background field.'],
  'velocity-selector': ['composite', 'A tiny sphere flying in a perfectly straight line through a rounded rectangular chamber, slim opposing arrows above and below balancing it.'],
  'mass-spectrometer': ['composite', 'A tiny sphere entering through a narrow slit then curving through a clean half-circle arc onto a flat detector shelf.'],
  'composite-eb': ['composite', 'A tiny sphere weaving one smooth S-shaped path through a rounded chamber marked by faint arrows and soft cross marks.'],
  'composite-ebg': ['composite', 'A tiny sphere following a long gentle drifting curve through a tall rounded chamber, faint arrows and cross marks in the field.'],
  'multi-region-field': ['composite', 'A tiny sphere crossing three softly tinted vertical zones: straight, then a half-circle turn, then a gentle curve, one continuous path.'],
  cyclotron: ['composite', 'Two facing D-shaped half discs with a narrow gap, a tiny sphere spiraling outward from the center in a clean expanding spiral.'],
  lab: ['mechanics', 'A minimal rounded laboratory flask with a single dotted elliptical orbit ring tilted around it, one tiny sphere on the ring.'],
  question: ['magnetic', 'A minimal rounded sheet of paper with a folded corner, one smooth dotted trajectory arc lifting off the page into space.'],
}

/* ----------------------------------------------------------------- http ---- */

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

const call = async (pathname, init = {}, timeoutMs = 300_000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
      signal: controller.signal,
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { /* html or empty */ }
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
    if (status === 404) return { failed: `task not pollable on this gateway (404 ${json?.error?.code ?? ''})` }
    if (json?.status === 'failed') return { failed: json?.error?.message ?? 'task failed' }
    if (json?.status === 'completed') return { item: json?.result?.data?.[0] ?? { url: json?.image_url } }
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
          `gateway returned upstream task stub ${stub}; ${settled.failed}. `
          + 'Server-side fix: enable async image object storage (Admin \u2192 Backup) '
          + 'or point the model at a synchronous upstream channel.',
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
  writeFileSync(path.join(OUT_DIR, `${id}.json`), `${JSON.stringify({
    asset: id, domain, model: MODEL, requested: SIZE, bytes: bytes.length,
    prompt, createdAt: new Date().toISOString(),
  }, null, 2)}\n`)
  process.stdout.write(`  \u2713 ${path.relative(ROOT, file)}  ${(bytes.length / 1024).toFixed(0)} KiB\n`)
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

const ids = argv.includes('--all') ? Object.keys(ASSETS) : argv.filter(arg => !arg.startsWith('--'))
const unknown = ids.filter(id => ASSETS[id] === undefined)
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
    process.stdout.write(`  \u2717 ${id}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
process.stdout.write(`\n${ids.length - failed} generated, ${failed} failed.\n`)
if (failed > 0) process.exitCode = 1
