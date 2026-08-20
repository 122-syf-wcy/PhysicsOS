#!/usr/bin/env node
/**
 * PhysicsOS development-time design asset generator.
 *
 * Reads provider credentials from the environment (or a gitignored .env at the
 * repo root) and writes raster concept art into UI/generated/. This script is
 * the ONLY place allowed to talk to an image provider: the browser client never
 * holds a key, and no key is ever written into source, metadata or a report.
 *
 * Generated rasters are visual REFERENCE for humans. Production 24px icons are
 * hand-redrawn as SVG React components; see src/client/icons/physics-icons.tsx.
 *
 * Usage:
 *   node scripts/design/generate-physics-assets.mjs --list
 *   node scripts/design/generate-physics-assets.mjs --all
 *   node scripts/design/generate-physics-assets.mjs icon-concept-sheet projectile-hero
 *   node scripts/design/generate-physics-assets.mjs --provider secondary --all
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT_DIR = path.join(ROOT, 'UI', 'generated')

/* ------------------------------------------------------------------ env ---- */

/** Load KEY=VALUE lines from .env without pulling in a dependency. */
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

/**
 * Provider config. `size` is what the API is asked for; the real pixel size can
 * be smaller (gpt-image-2 caps around 2880² even when asked for 4096²), so the
 * metadata records the size actually decoded from the bytes.
 */
const PROVIDERS = {
  primary: {
    id: 'primary',
    baseUrl: process.env.PHYSICSOS_IMAGE_PRIMARY_BASE_URL,
    apiKey: process.env.PHYSICSOS_IMAGE_PRIMARY_API_KEY,
    model: process.env.PHYSICSOS_IMAGE_PRIMARY_MODEL,
    /** Ask for 4K; the service returns the largest it supports. */
    body: (prompt) => ({ prompt, n: 1, size: '4096x4096' }),
    timeoutMs: 420_000,
  },
  secondary: {
    id: 'secondary',
    baseUrl: process.env.PHYSICSOS_IMAGE_SECONDARY_BASE_URL,
    apiKey: process.env.PHYSICSOS_IMAGE_SECONDARY_API_KEY,
    model: process.env.PHYSICSOS_IMAGE_SECONDARY_MODEL,
    /* grok-imagine rejects most explicit `size` strings with
       "aspect_ratio 不受支持"; it accepts an aspect ratio instead. */
    body: (prompt) => ({ prompt, n: 1, aspect_ratio: '1:1' }),
    timeoutMs: 240_000,
  },
}

/* --------------------------------------------------------------- prompts --- */

const NEGATIVE = [
  'no cartoon',
  'no childrens book illustration',
  'no classroom clipart',
  'no textbook clipart',
  'no neon',
  'no dark theme',
  'no purple',
  'no decorative gradients',
  'no drop shadows',
  'no 3D bevel',
  'no perspective distortion',
  'no UI chrome',
  'no browser window',
  'no words',
  'no letters',
  'no numbers',
  'no emoji',
].join(', ')

const ASSETS = {
  'icon-concept-sheet': {
    title: 'PhysicsOS Scientific Icon System Concept Sheet',
    provider: 'primary',
    prompt: `A single flat concept sheet presenting a unified premium line-icon system for PhysicsOS, a desktop scientific physics workstation for secondary-school physics.

Visual language: modern, restrained, precise, scientific-instrument feel, like high-end desktop engineering software rather than a childrens education app.

Pure white background. A calm regular grid of clearly separated icon cells with generous spacing between every icon.

Every icon: consistent 1.75px optical stroke weight, rounded stroke caps, drawn on a 24x24 pixel grid, dark slate-blue linework, at most a small amount of light physics-blue fill as accent.

Icon subjects, one per cell: physics laboratory, exam question sheet, kinematics, velocity, acceleration, trajectory arc, gravity, single force arrow, resultant force, Newton's second law, horizontal projectile launch, oblique projectile launch, inclined plane, friction, normal force, time, line chart, measurement caliper, verification checkmark, scene layers, observable eye, variable, play, pause, reset.

Each icon isolated and self-contained, flat front-facing two-dimensional vector icon, orthographic, ${NEGATIVE}.`,
  },

  'component-reference-sheet': {
    title: 'PhysicsOS Mechanics Components Reference Sheet',
    provider: 'primary',
    prompt: `A single flat technical reference sheet showing the individual drawing primitives of a mechanics physics canvas, laid out as clearly separated specimens on a pure white background, for a developer to reproduce one-to-one in vector code.

Specimens: a small solid physical block, a small sphere, an inclined plane wedge with a clean hatched base, a raised launch platform, a ground line with light hatching beneath, a small trajectory sample marker, an apex marker, an impact marker, a thin velocity arrow with a slim arrowhead, a thicker force arrow with a solid arrowhead, an angle arc with two bounding rays, a dimension line with fine tick serifs at both ends, a two-axis coordinate cross with tick marks, and a small timeline event marker.

Style: precise engineering-diagram linework, thin consistent strokes, low-saturation physics blue and slate grey, generous white space, calm and analytical.

Flat front-facing two-dimensional vector specimens, orthographic, ${NEGATIVE}.`,
  },

  'projectile-hero': {
    title: 'Projectile motion hero illustration',
    provider: 'primary',
    prompt: `PhysicsOS projectile motion scientific interface illustration, clean premium scientific software aesthetic, warm white background, subtle pale blue coordinate grid, small physical ball launched horizontally from a minimalist platform, precise parabolic trajectory, velocity vector tangent to trajectory, separated horizontal and vertical velocity component vectors, downward gravity vector, small launch and impact markers, technical measurement annotations drawn as plain tick marks only, thin high-precision linework, soft restrained depth, desktop scientific workstation visual language, isolated visualization asset, ${NEGATIVE}.`,
  },

  'inclined-plane-hero': {
    title: 'Inclined plane hero illustration',
    provider: 'primary',
    prompt: `PhysicsOS inclined plane scientific visualization asset, premium desktop physics software aesthetic, minimal inclined plane and precision block, force arrows for gravity, normal force and friction, gravity decomposition geometry drawn with fine construction lines, clean angle arc at the base of the incline, subtle coordinate basis, warm white and ice-blue background, physics blue technical linework, restrained coral used only for force emphasis, precise engineering-diagram composition, light realistic material depth but primarily scientific visualization, ${NEGATIVE}.`,
  },

  'newton-force-hero': {
    title: 'Newton second law hero illustration',
    provider: 'primary',
    prompt: `PhysicsOS Newton's second law scientific visualization asset, premium desktop physics software aesthetic, a single precision block on a level surface, one clean horizontal applied force arrow, a resultant force arrow, a distinct acceleration arrow rendered in warm amber, downward gravity and upward normal force arrows in balance, warm white background with a faint pale blue grid, thin precise engineering linework, physics blue as the primary hue, restrained and analytical composition, ${NEGATIVE}.`,
  },

  'uniform-acceleration-hero': {
    title: 'Uniform acceleration hero illustration',
    provider: 'primary',
    prompt: `PhysicsOS uniformly accelerated linear motion scientific visualization asset, premium desktop physics software aesthetic, a small precision block travelling along a straight horizontal reference line, a sequence of ghosted stroboscopic positions with progressively increasing spacing to convey acceleration, a velocity arrow growing longer at each sample, a constant acceleration arrow in warm amber, fine dimension ticks along the path, warm white background with faint pale blue grid, thin exact engineering linework, calm analytical composition, ${NEGATIVE}.`,
  },

  'lab-empty-state': {
    title: 'Physics Lab empty-state background',
    provider: 'primary',
    prompt: `An extremely subtle, very low contrast decorative background texture for the empty state of a scientific physics workstation. Warm white field with a barely visible pale ice-blue technical lattice, a few faint construction arcs and thin ghosted parabolic curves drawn at very low opacity, as if physics diagrams were pressed lightly into paper. Calm, quiet, almost blank, nothing dominant, wide open empty centre so interface text can sit on top and stay perfectly readable. Flat, orthographic, ${NEGATIVE}.`,
  },
}

/* ----------------------------------------------------------------- utils --- */

/** Decode intrinsic pixel size so metadata records reality, not the request. */
const imageSizeOf = (bytes) => {
  if (bytes.length > 24 && bytes.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isStartOfFrame) {
        return {
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
          format: 'jpeg',
        }
      }
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
  }
  if (bytes.length > 16 && bytes.subarray(0, 4).toString('latin1') === 'RIFF') {
    return { width: 0, height: 0, format: 'webp' }
  }
  return { width: 0, height: 0, format: 'unknown' }
}

/**
 * Some providers hand back a URL on their own loopback host. Re-point it at the
 * public base URL so the download actually resolves from here.
 */
const resolveAssetUrl = (rawUrl, baseUrl) => {
  const url = new URL(rawUrl)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return rawUrl
  const base = new URL(baseUrl)
  url.protocol = base.protocol
  url.host = base.host
  return url.toString()
}

const fetchWithTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * These providers proxy to an upstream that intermittently 502s on long prompts,
 * so a transient gateway failure is retried rather than dropping the asset. A 4xx
 * is a real request problem and fails immediately.
 */
const postWithRetry = async (endpoint, init, timeoutMs, attempts = 3) => {
  let lastError = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response
    try {
      response = await fetchWithTimeout(endpoint, init, timeoutMs)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt === attempts) break
      process.stdout.write(`  … network error, retry ${attempt + 1}/${attempts}\n`)
      await sleep(4000 * attempt)
      continue
    }
    const text = await response.text()
    if (response.ok) return text
    lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`
    const transient = response.status >= 500 || response.status === 429
    if (!transient || attempt === attempts) break
    process.stdout.write(`  … ${lastError.slice(0, 80)}, retry ${attempt + 1}/${attempts}\n`)
    await sleep(6000 * attempt)
  }
  throw new Error(lastError)
}

/* -------------------------------------------------------------- generate --- */

const generate = async (key, providerOverride) => {
  const asset = ASSETS[key]
  if (asset === undefined) throw new Error(`Unknown asset "${key}".`)

  const provider = PROVIDERS[providerOverride ?? asset.provider]
  if (provider === undefined) throw new Error(`Unknown provider "${providerOverride}".`)
  for (const field of ['baseUrl', 'apiKey', 'model']) {
    if (typeof provider[field] !== 'string' || provider[field].length === 0) {
      throw new Error(
        `Provider "${provider.id}" is not configured: set the PHYSICSOS_IMAGE_${provider.id.toUpperCase()}_* variables in .env (see .env.example).`,
      )
    }
  }

  const endpoint = `${provider.baseUrl.replace(/\/+$/, '')}/v1/images/generations`
  const payload = { model: provider.model, ...provider.body(asset.prompt) }

  process.stdout.write(`· ${key} → ${provider.id}/${provider.model} …\n`)
  const started = Date.now()
  const text = await postWithRetry(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    provider.timeoutMs,
  )

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${key}: provider returned non-JSON: ${text.slice(0, 200)}`)
  }

  const item = parsed?.data?.[0]
  if (item === undefined) throw new Error(`${key}: provider returned no image entry.`)

  /* b64_json is present but EMPTY for large sizes on gpt-image-2, so a
     non-empty check — not a presence check — decides the download path. */
  let bytes
  if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
    bytes = Buffer.from(item.b64_json, 'base64')
  } else if (typeof item.url === 'string' && item.url.length > 0) {
    const assetUrl = resolveAssetUrl(item.url, provider.baseUrl)
    const download = await fetchWithTimeout(assetUrl, {}, provider.timeoutMs)
    if (!download.ok) {
      throw new Error(`${key}: image download failed with HTTP ${download.status}.`)
    }
    bytes = Buffer.from(await download.arrayBuffer())
  } else {
    throw new Error(`${key}: provider returned neither inline data nor a URL.`)
  }

  const measured = imageSizeOf(bytes)
  const extension = measured.format === 'unknown' ? 'png' : measured.format
  const file = path.join(OUT_DIR, `${key}.${extension}`)
  writeFileSync(file, bytes)

  /* Metadata records provenance only. Never the API key, never the endpoint. */
  const metadata = {
    asset: key,
    title: asset.title,
    provider: provider.id,
    model: provider.model,
    requested: provider.body('').size ?? provider.body('').aspect_ratio ?? 'default',
    pixels: `${measured.width}x${measured.height}`,
    bytes: bytes.length,
    prompt: asset.prompt,
    revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : null,
    createdAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
  }
  writeFileSync(path.join(OUT_DIR, `${key}.json`), `${JSON.stringify(metadata, null, 2)}\n`)

  process.stdout.write(
    `  ✓ ${path.relative(ROOT, file)}  ${metadata.pixels}  ${(bytes.length / 1024).toFixed(0)} KiB  ${(metadata.elapsedMs / 1000).toFixed(1)}s\n`,
  )
  return metadata
}

/* ------------------------------------------------------------------ main --- */

const argv = process.argv.slice(2)

if (argv.includes('--list') || argv.length === 0) {
  process.stdout.write('PhysicsOS design assets:\n')
  for (const [key, asset] of Object.entries(ASSETS)) {
    process.stdout.write(`  ${key.padEnd(28)} ${asset.provider.padEnd(10)} ${asset.title}\n`)
  }
  process.stdout.write('\nRun with --all, or pass asset keys. Add --provider secondary to override.\n')
  process.exit(0)
}

const providerIndex = argv.indexOf('--provider')
const providerOverride = providerIndex === -1 ? undefined : argv[providerIndex + 1]
const keys = argv.includes('--all')
  ? Object.keys(ASSETS)
  : argv.filter((entry, index) => {
    if (entry.startsWith('--')) return false
    if (providerIndex !== -1 && index === providerIndex + 1) return false
    return true
  })

mkdirSync(OUT_DIR, { recursive: true })

const results = []
const failures = []
for (const key of keys) {
  try {
    results.push(await generate(key, providerOverride))
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
    process.stdout.write(`  ✗ ${key}: ${failures.at(-1)}\n`)
  }
}

process.stdout.write(`\n${results.length} generated, ${failures.length} failed.\n`)
if (failures.length > 0) process.exitCode = 1
