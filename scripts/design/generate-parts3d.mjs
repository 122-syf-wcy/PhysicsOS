#!/usr/bin/env node
/**
 * generate-parts3d.mjs — 电学台器材精灵生成（dev-only，产出不进浏览器代码）。
 *
 * 为什么是位图：竞品「粒子先生的物理实验室」的观感优势来自 3/4 视角的 3D
 * 渲染器材位图（parts3d），而不是渲染引擎 —— 双方都是 SVG + rAF。本项目此
 * 前只有 1.6px 单色线框原理图符号，器材本体没有任何材质与体积，这是"看着
 * 低"的首要原因。本脚本按同一条技术路线自制精灵（不取用对方任何资产）。
 *
 * 关键约束（决定精灵能不能直接进 SVG 混排）：
 *   * 全透明背景 —— 已验证网关支持 `background: "transparent"`，出图即带真实
 *     alpha，无需抠图。
 *   * 全套共用一台相机与一束光：俯视 3/4 正交、左上主光。器材之间角度/光向
 *     不一致的话，拼在同一张台面上会立刻露馅。
 *   * 一致的参照尺度：以接线柱为 1cm 基准，让灯泡/电阻/电表的相对大小正确。
 *   * 表盘刻意留白：A/V 字样由渲染层用 SVG 文本叠上去，这样读数、字母样式
 *     仍受我们控制，且能随状态变化 —— 不交给图片模型。
 *
 * 凭据只从 .env 读（gitignored），与 scripts/design/imagegen-client.mjs 同一
 * 套 PHYSICSOS_IMAGE_PRIMARY_* 变量；本文件从不打印密钥。
 *
 * 用法：
 *   node scripts/design/generate-parts3d.mjs            # 全部生成
 *   node scripts/design/generate-parts3d.mjs lamp-off   # 只生成指定 id
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const OUT_DIR = path.join('overlays', 'harness', 'files', 'apps', 'web', 'public', 'physicsos', 'parts3d')
const CONCURRENCY = 3
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [15_000, 45_000]

/* ------------------------------------------------------------------ 读凭据 -- */

const readEnv = () => {
  if (!existsSync('.env')) throw new Error('.env 不存在；无法读取生图凭据')
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')).trim(),
        line.slice(line.indexOf('=') + 1).trim(),
      ]),
  )
}

const env = readEnv()
const BASE_URL = (env.PHYSICSOS_IMAGE_PRIMARY_BASE_URL ?? '').replace(/\/+$/, '')
const API_KEY = env.PHYSICSOS_IMAGE_PRIMARY_API_KEY
const MODEL = env.PHYSICSOS_IMAGE_PRIMARY_MODEL || 'gpt-image-2'
if (!BASE_URL || !API_KEY) throw new Error('缺少 PHYSICSOS_IMAGE_PRIMARY_BASE_URL / _API_KEY')

/* ------------------------------------------------------------------- 风格 -- */

/* 全套共用。任何一条改动都会让新旧器材的相机/光向对不上，所以改风格就要重生成全套。 */
const STYLE = [
  'photorealistic 3D render of a single school-laboratory physics apparatus item,',
  'three-quarter view from above at roughly 45 degrees elevation, orthographic lens,',
  'object perfectly centred and fully inside the frame with generous margin,',
  'soft studio lighting with one key light from the upper left and gentle fill,',
  'subtle specular highlights, restrained muted palette of steel, brass, ceramic and dark bakelite,',
  'only a faint ambient-occlusion darkening at the very base, no cast shadow on the ground,',
  'isolated on a fully transparent background, nothing else in frame,',
  'professional product-shot clarity, physically plausible proportions,',
  'no text, no letters, no numbers, no logo, no watermark, no border, no backdrop',
].join(' ')

/** 以 1cm 接线柱为参照，保证器材之间的相对尺度一致。 */
const SCALE_NOTE = 'All items are rendered at a consistent scale relative to a 1 cm binding post.'

const PARTS = [
  {
    id: 'lamp-off',
    body: 'a small incandescent lamp bulb with a clear glass envelope and a brass screw base, '
      + 'switched off, the filament inside visible as a thin dark wire',
  },
  {
    id: 'lamp-on',
    body: 'a small incandescent lamp bulb with a clear glass envelope and a brass screw base, '
      + 'switched on and glowing brightly, a hot yellow-white filament inside casting a warm halo '
      + 'through the glass',
  },
  {
    id: 'resistor',
    body: 'a cylindrical carbon-film resistor with axial wire leads, a light ceramic body painted '
      + 'with three coloured bands and a gold tolerance band, both straight metal leads extending '
      + 'left and right along the same horizontal axis',
  },
  {
    id: 'rheostat',
    body: 'a laboratory sliding rheostat, a horizontal ceramic tube wound with bare resistance wire, '
      + 'a bare metal slider riding on a brass guide rail above it, with a vertical metal rod and two '
      + 'binding posts at the base',
  },
  {
    id: 'battery',
    body: 'a laboratory DC power source, a compact rectangular battery pack in a dark bakelite case '
      + 'with two brass binding posts on top and a small metal label plate, both terminals clearly '
      + 'visible',
  },
  {
    id: 'switch-open',
    body: 'a laboratory single-pole knife switch mounted on a small dark wooden base, the flat brass '
      + 'blade lifted up and tilted away from the contacts so the circuit is open, two brass binding '
      + 'posts at the two ends of the base',
  },
  {
    id: 'switch-closed',
    body: 'a laboratory single-pole knife switch mounted on a small dark wooden base, the flat brass '
      + 'blade lowered and lying flat across the two contacts so the circuit is closed, two brass '
      + 'binding posts at the two ends of the base',
  },
  {
    id: 'ammeter',
    body: 'an analogue panel ammeter in a rectangular black bakelite housing with a brushed metal '
      + 'bezel, a blank white dial face that is completely empty with no markings of any kind, a thin '
      + 'black needle resting near the middle, two brass binding posts at the lower edge',
  },
  {
    id: 'voltmeter',
    body: 'an analogue panel voltmeter in a rectangular black bakelite housing with a brushed metal '
      + 'bezel, a blank white dial face that is completely empty with no markings of any kind, a thin '
      + 'black needle resting near the middle, two brass binding posts at the lower edge',
  },
  {
    id: 'terminal',
    body: 'a single brass laboratory binding post terminal, a short threaded metal post with a '
      + 'knurled nut and a flat base, standing upright',
  },
]

/* ------------------------------------------------------------------ 出图 -- */

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

const requestOnce = async (prompt) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300_000)
  try {
    const response = await fetch(`${BASE_URL}/v1/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: '1024x1024',
        background: 'transparent',
        output_format: 'png',
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = undefined }
    if (response.status !== 200) {
      return { ok: false, status: response.status, error: json?.error?.message ?? text.slice(0, 200) }
    }
    const item = json?.data?.[0]
    let bytes
    if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
      bytes = Buffer.from(item.b64_json, 'base64')
    } else if (typeof item?.url === 'string') {
      const imageResponse = await fetch(item.url)
      if (!imageResponse.ok) return { ok: false, status: imageResponse.status, error: 'download failed' }
      bytes = Buffer.from(await imageResponse.arrayBuffer())
    } else {
      return { ok: false, status: response.status, error: `unexpected body: ${text.slice(0, 160)}` }
    }
    return { ok: true, bytes }
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** 同一件器材最多试 MAX_ATTEMPTS 次；5xx 与网络错误退避重试，4xx 立即放弃。 */
const generateWithRetry = async (part) => {
  const prompt = `${part.body}. ${STYLE} ${SCALE_NOTE}`
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now()
    const result = await requestOnce(prompt)
    const elapsedMs = Date.now() - started
    if (result.ok) return { ...result, prompt, elapsedMs, attempt }
    const retryable = result.status === 0 || result.status >= 500 || result.status === 429
    process.stderr.write(`  ! ${part.id} 第 ${attempt} 次失败 (HTTP ${result.status}: ${result.error})\n`)
    if (!retryable || attempt === MAX_ATTEMPTS) {
      return { ok: false, prompt, error: result.error, status: result.status, attempt }
    }
    await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
  }
  return { ok: false, prompt, error: 'exhausted', status: 0, attempt: MAX_ATTEMPTS }
}

/** 固定并发跑一批任务，保持输出顺序与输入一致。 */
const mapLimited = async (items, limit, worker) => {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/* ------------------------------------------------------------------ 主流程 -- */

const main = async () => {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const targets = only.length > 0
    ? PARTS.filter((part) => only.includes(part.id))
    : PARTS
  if (targets.length === 0) {
    throw new Error(`没有匹配的器材 id。可用：${PARTS.map((p) => p.id).join(', ')}`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`网关 ${BASE_URL}  模型 ${MODEL}  共 ${targets.length} 件  并发 ${CONCURRENCY}`)

  const results = await mapLimited(targets, CONCURRENCY, async (part) => {
    const outcome = await generateWithRetry(part)
    if (!outcome.ok) {
      process.stderr.write(`  ✗ ${part.id}: ${outcome.error}\n`)
      return { part, ok: false }
    }
    const file = path.join(OUT_DIR, `${part.id}.png`)
    writeFileSync(file, outcome.bytes)
    writeFileSync(
      path.join(OUT_DIR, `${part.id}.json`),
      `${JSON.stringify({
        id: part.id,
        file: `${part.id}.png`,
        model: MODEL,
        endpoint: BASE_URL,
        bytes: outcome.bytes.length,
        createdAt: new Date().toISOString(),
        elapsedMs: outcome.elapsedMs,
        attempts: outcome.attempt,
        prompt: outcome.prompt,
      }, null, 2)}\n`,
    )
    console.log(`  ✓ ${part.id}  ${(outcome.bytes.length / 1024).toFixed(0)} KiB  (${(outcome.elapsedMs / 1000).toFixed(1)}s)`)
    return { part, ok: true }
  })

  const ok = results.filter((r) => r.ok).length
  console.log(`\n${ok}/${targets.length} 件器材已生成到 ${OUT_DIR}`)
  /* 非零退出，让"图没出全"不会被静默当成成功。 */
  if (ok !== targets.length) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
