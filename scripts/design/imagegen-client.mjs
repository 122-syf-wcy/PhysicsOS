#!/usr/bin/env node
/**
 * imagegen-client.mjs — OpenAI-compatible image generation client for PhysicsOS.
 *
 * Talks to any OpenAI-compatible /v1/images/generations gateway (default
 * https://zz.211b.site), saves PNGs plus per-image and aggregate manifest
 * metadata, and fails loudly with a non-zero exit code.
 *
 * Config via environment variables or CLI flags (CLI wins):
 *   BASE_URL  / --base-url    gateway origin, default https://zz.211b.site
 *   API_KEY   / --api-key     bearer token (never hard-code in committed files)
 *   MODEL     / --model       model id, default gpt-image
 *   PROMPT    / --prompt      generation prompt (English works best for image models)
 *   OUTPUT    / --output      PNG path (or a directory when --count > 1)
 *   COUNT     / --count       number of images to produce from the same prompt
 *   SIZE      / --size        e.g. 1024x1024; default 1024x1024
 *
 * Extra flags:
 *   --list-models            print available models from /v1/models and exit
 *   --response-format FMT    pass response_format through (most gpt-image
 *                            models ignore it; omitted by default)
 *   --quiet                  suppress progress output
 *
 * Automatic fallbacks (each one is logged; the actual choice is recorded in
 * the metadata so provenance stays honest):
 *   * If the gateway rejects the requested model name, the first model listed
 *     by /v1/models is retried once.
 *   * If the gateway rejects the requested size, the request is retried once
 *     without the size field.
 *
 * Output layout:
 *   <output>.png            the generated image
 *   <output>.json           per-image metadata (prompt, model, endpoint, ...)
 *   <output-dir>/manifest.json  aggregate manifest, appended across runs
 *
 * Requires Node >= 20 (native fetch). Exit code 0 on success, 1 on failure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DEFAULTS = {
  BASE_URL: 'https://zz.211b.site',
  MODEL: 'gpt-image',
  SIZE: '1024x1024',
  COUNT: 1,
}

/* ------------------------------------------------------------------ args ---- */

const argv = process.argv.slice(2)
const FLAGS = new Map() // long flag (sans --) -> value | true
const POSITIONAL = []
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--') {
    POSITIONAL.push(...argv.slice(i + 1))
    break
  }
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=')
    if (eq >= 0) {
      FLAGS.set(arg.slice(2, eq), arg.slice(eq + 1))
    } else {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        FLAGS.set(arg.slice(2), next)
        i += 1
      } else {
        FLAGS.set(arg.slice(2), true)
      }
    }
  } else {
    POSITIONAL.push(arg)
  }
}

/** env falls back to defaults; CLI flags override env. */
const value = (envKey, flagKey) => {
  if (FLAGS.has(flagKey)) return FLAGS.get(flagKey)
  const env = process.env[envKey]
  return env !== undefined && env !== '' ? env : DEFAULTS[envKey]
}

const BASE_URL = value('BASE_URL', 'base-url').replace(/\/+$/, '')
const API_KEY = value('API_KEY', 'api-key')
const MODEL = value('MODEL', 'model')
const PROMPT = value('PROMPT', 'prompt')
const OUTPUT = value('OUTPUT', 'output')
const COUNT = Math.max(1, Number.parseInt(value('COUNT', 'count') ?? '1', 10) || 1)
const SIZE = value('SIZE', 'size')
const RESPONSE_FORMAT = FLAGS.has('response-format') ? FLAGS.get('response-format') : undefined
const QUIET = FLAGS.has('quiet')

const log = (msg) => {
  if (!QUIET) process.stdout.write(`${msg}\n`)
}
const fail = (msg) => {
  process.stderr.write(`error: ${msg}\n`)
  process.exitCode = 1
}

const assertCreds = () => {
  if (!API_KEY || API_KEY === true) {
    fail('API_KEY missing: set API_KEY env or pass --api-key (never hard-code keys in scripts).')
    return false
  }
  if (!PROMPT || PROMPT === true) {
    fail('PROMPT missing: set PROMPT env or pass --prompt.')
    return false
  }
  if (!OUTPUT || OUTPUT === true) {
    fail('OUTPUT missing: set OUTPUT env or pass --output (PNG path or directory).')
    return false
  }
  return true
}

/* ----------------------------------------------------------------- http ---- */

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * One request helper with timeout. Resolves to { status, json, text } — never
 * throws on HTTP errors so callers can inspect the body and decide on retries.
 */
const call = async (pathname, init = {}, timeoutMs = 600_000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
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
      /* html or empty body */
    }
    return { status: response.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

/** List models from /v1/models (OpenAI-compatible gateways). */
const listModels = async () => {
  const { status, json, text } = await call('/v1/models', {}, 30_000)
  if (status !== 200) {
    fail(`GET /v1/models -> HTTP ${status}: ${text.slice(0, 200) || '(empty body)'}`)
    return null
  }
  const models = (json?.data ?? []).map((m) => m.id ?? m).filter(Boolean)
  return models
}

const gatewayError = (res) => {
  if (res.json?.error) {
    const message = res.json.error.message ?? ''
    const type = res.json.error.type ?? ''
    return `HTTP ${res.status} ${type ? `(${type}) ` : ''}${message}`.trim()
  }
  return `HTTP ${res.status}: ${res.text.slice(0, 200) || '(empty body)'}`
}

/**
 * POST /v1/images/generations with a given model; returns the first data item
 * ({ b64_json } or { url }) or null. Does not perform fallbacks here.
 */
const generateOnce = async (model, size) => {
  const body = { model, prompt: PROMPT, n: 1 }
  if (size) body.size = size
  if (RESPONSE_FORMAT !== undefined) body.response_format = RESPONSE_FORMAT
  const res = await call('/v1/images/generations', { method: 'POST', body: JSON.stringify(body) })
  if (res.status !== 200) return { ok: false, error: gatewayError(res), status: res.status }
  const item = res.json?.data?.[0]
  if (!item || (typeof item.b64_json !== 'string' && typeof item.url !== 'string')) {
    return {
      ok: false,
      error: `unexpected success body: ${res.text.slice(0, 160)}`,
      status: res.status,
    }
  }
  return { ok: true, item, revisedPrompt: res.json?.data?.[0]?.revised_prompt }
}

/** Backoff delays (ms) used when the gateway answers with a 5xx. */
const RETRY_DELAYS = [10_000, 20_000, 40_000, 60_000, 90_000]

/**
 * Generate one image with automatic fallbacks:
 *   1. requested model/size first
 *   2. if the model name is rejected, retry with the gateway's first listed model
 *   3. if the size is rejected, retry without the size field
 *   4. transient 5xx (e.g. 502 upstream error) are retried with backoff
 * Returns { ok, bytes, model, size, revisedPrompt, note, error, status }.
 */
const generateWithFallbacks = async () => {
  const attempts = []
  let model = MODEL
  let size = SIZE

  const tryOnce = async (m, s) => {
    const result = await generateOnce(m, s)
    attempts.push({ model: m, size: s ?? null, status: result.status, ok: result.ok })
    return result
  }

  let result = await tryOnce(model, size)

  /* Model-name fallback: many gateways expose a different id than the doc
     default (e.g. "gpt-image-2" instead of "gpt-image"). */
  if (
    !result.ok &&
    /requires an image model|model.*(not found|not exist)|unknown model/i.test(result.error ?? '')
  ) {
    log(`  ~ model "${model}" rejected (${result.error}); probing /v1/models ...`)
    const models = await listModels()
    if (models && models.length > 0) {
      model = models[0]
      log(`  ~ retrying with gateway model "${model}"`)
      result = await tryOnce(model, size)
    }
  }

  /* Size fallback: some models only accept a fixed set of sizes. */
  if (!result.ok && size && /size|resolution/i.test(result.error ?? '')) {
    log(`  ~ size "${size}" rejected (${result.error}); retrying without size`)
    result = await tryOnce(model, undefined)
  }

  /* Transient upstream failure: gateways behind a busy image backend answer
     with 502/503. Retry with backoff rather than failing the whole run. */
  let retryDelayIndex = 0
  while (!result.ok && result.status >= 500 && retryDelayIndex < RETRY_DELAYS.length) {
    const delay = RETRY_DELAYS[retryDelayIndex]
    retryDelayIndex += 1
    log(
      `  ~ upstream error (${result.error}); waiting ${(delay / 1000).toFixed(0)}s and retrying \u2026`,
    )
    await sleep(delay)
    result = await tryOnce(model, size)
  }

  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status, attempts }
  }

  /* Decode base64 or download the signed URL. */
  let bytes
  if (typeof result.item.b64_json === 'string' && result.item.b64_json.length > 0) {
    bytes = Buffer.from(result.item.b64_json, 'base64')
  } else {
    const response = await fetch(result.item.url)
    if (!response.ok) throw new Error(`image download HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  return { ok: true, bytes, model, size, revisedPrompt: result.revisedPrompt, attempts }
}

/* ------------------------------------------------------------ metadata ---- */

const pixelsOf = (bytes, requested) => {
  /* PNG: bytes 16..23 hold width/height as big-endian u32. */
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    const w = bytes.readUInt32BE(16)
    const h = bytes.readUInt32BE(20)
    return `${w}x${h}`
  }
  return requested ?? 'unknown'
}

const loadManifest = (dir) => {
  const file = path.join(dir, 'manifest.json')
  if (!existsSync(file)) return { file, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { file, entries: Array.isArray(parsed) ? parsed : [] }
  } catch {
    return { file, entries: [] }
  }
}

const appendManifest = (dir, entry) => {
  const { file, entries } = loadManifest(dir)
  entries.push(entry)
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`)
}

/* ------------------------------------------------------------- generate ---- */

const run = async () => {
  if (FLAGS.has('list-models')) {
    const models = await listModels()
    if (models === null) return
    if (models.length === 0) {
      fail('GET /v1/models returned an empty list.')
      return
    }
    log(models.join('\n'))
    return
  }

  if (!assertCreds()) return

  const base = OUTPUT.replace(/\.png$/i, '')
  const outDir = COUNT > 1 ? base : path.dirname(base) || '.'
  const outStem = COUNT > 1 ? path.join(base, path.basename(base)) : base
  mkdirSync(COUNT > 1 ? base : outDir, { recursive: true })

  log(`endpoint: ${BASE_URL}`)
  log(`model:    ${MODEL}   size: ${SIZE}   count: ${COUNT}`)
  log(`prompt:   ${PROMPT.slice(0, 140)}${PROMPT.length > 140 ? '…' : ''}`)

  let failures = 0
  for (let i = 0; i < COUNT; i += 1) {
    const suffix = COUNT > 1 ? `-${String(i + 1).padStart(2, '0')}` : ''
    const pngFile = `${outStem}${suffix}.png`
    log(`\u00b7 generating ${path.basename(pngFile)} \u2026`)
    const started = Date.now()
    let outcome
    try {
      outcome = await generateWithFallbacks()
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    const elapsedMs = Date.now() - started

    if (!outcome.ok) {
      failures += 1
      const attempts = (outcome.attempts ?? [])
        .map((a) => `${a.model}${a.size ? `/${a.size}` : ''}->HTTP ${a.status}`)
        .join(', ')
      process.stderr.write(
        `  \u2717 ${path.basename(pngFile)}: ${outcome.error}${attempts ? `  [attempts: ${attempts}]` : ''}\n`,
      )
      continue
    }

    writeFileSync(pngFile, outcome.bytes)
    const pixels = pixelsOf(outcome.bytes, outcome.size)
    const entry = {
      file: path.relative(outDir, pngFile).replace(/\\/g, '/'),
      prompt: PROMPT,
      model: outcome.model,
      endpoint: BASE_URL,
      requestedSize: outcome.size ?? SIZE,
      pixels,
      bytes: outcome.bytes.length,
      createdAt: new Date().toISOString(),
      elapsedMs,
    }
    if (outcome.revisedPrompt) entry.revisedPrompt = outcome.revisedPrompt
    if (outcome.model !== MODEL)
      entry.note = `requested "${MODEL}", gateway resolved "${outcome.model}"`

    writeFileSync(`${outStem}${suffix}.json`, `${JSON.stringify(entry, null, 2)}\n`)
    appendManifest(outDir, entry)
    log(
      `  \u2713 ${path.relative(process.cwd(), pngFile)}  ${(outcome.bytes.length / 1024).toFixed(0)} KiB  ${pixels}  (${(elapsedMs / 1000).toFixed(1)}s)`,
    )
  }

  const total = COUNT - failures
  log(`\n${total}/${COUNT} images generated into ${outDir} (manifest: manifest.json).`)
  if (failures > 0) process.exitCode = 1
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
