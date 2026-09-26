#!/usr/bin/env node
/* global AbortController, URL, clearTimeout, console, process, setTimeout */
import { pathToFileURL } from 'node:url'

const DEFAULT_URL = 'http://127.0.0.1:3080/readyz'
const DEFAULT_TIMEOUT_MS = 2000
const MAX_TIMEOUT_MS = 30_000
const MAX_URL_LENGTH = 2048
const MAX_BODY_LENGTH = 4096

function codeOf(error) {
  const code = error && typeof error === 'object' ? error.code : undefined
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : 'CHECK_FAILED'
}

/**
 * Probe one health endpoint with a bounded request.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, status: number, body: string } | { ok: false, error: string, status?: number, body?: string }>}
 */
export async function checkHealth(url, options = {}) {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'INVALID_URL' }
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'INVALID_URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'INVALID_URL' }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    return { ok: false, error: 'INVALID_TIMEOUT' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const body = (await response.text()).slice(0, MAX_BODY_LENGTH)
    if (!response.ok) {
      return { ok: false, status: response.status, body }
    }
    return { ok: true, status: response.status, body }
  } catch (error) {
    return {
      ok: false,
      error: controller.signal.aborted ? 'TIMEOUT' : codeOf(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const result = await checkHealth(process.argv[2] ?? process.env.HEALTHCHECK_URL ?? DEFAULT_URL)
  if (result.ok) {
    console.log(`healthcheck: ready (${String(result.status)})`)
  } else {
    console.error(
      `healthcheck: ${result.error}${result.status === undefined ? '' : ` (${String(result.status)})`}`,
    )
    if (result.body !== undefined && result.body !== '') console.error(result.body)
    process.exitCode = 1
  }
}
