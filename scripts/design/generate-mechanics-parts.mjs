#!/usr/bin/env node
/**
 * generate-mechanics-parts.mjs — 力学台器材精灵生成（dev-only，产出不进浏览器代码）。
 *
 * 为什么与 generate-parts3d.mjs 分开：力学装置是**正侧视**，电路是**正俯视**。
 * 把两批混在一个脚本里，改一方的相机条款就会把另一方的器材拍歪，所以相机与
 * 器材表各自独立，只共享同样的流程：出图 → postprocess 裁剪归一化 → 量锚点 →
 * 写 catalog / manifest 双向校验。
 *
 * 契约见 docs/superpowers/specs/2026-09-14-mechanics-apparatus-realism.md：
 *   * 正侧视正交、器材立在一条横贯全幅的水平地平线上（量测基准）。
 *   * 无地面投影，只在底部留极淡接触阴影——投影会污染轮廓量测。
 *   * 全透明背景；以 1 m 米尺为统一比例基准。
 *
 * 凭据只从 .env 读（gitignored），与电路脚本同一套 PHYSICSOS_IMAGE_PRIMARY_*；
 * 本文件从不打印密钥。
 *
 * 用法：
 *   node scripts/design/generate-mechanics-parts.mjs             # 全部
 *   node scripts/design/generate-mechanics-parts.mjs block ball  # 指定
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/* 落在 parts3d 下的子批次目录：裁剪、清单合并与验收脚本都按 parts3d/<批次>
   工作，力学另起一个平行目录就要把这些工具全部复制一遍，不值得。 */
const OUT_DIR = path.join(
  'overlays',
  'harness',
  'files',
  'apps',
  'web',
  'public',
  'physicsos',
  'parts3d',
  process.env.MECHANICS3D_OUT || 'mechanics',
)
const CONCURRENCY = 3
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [15_000, 45_000]

/* ------------------------------------------------------------------ 读凭据 -- */

const readEnv = () => {
  if (!existsSync('.env')) throw new Error('.env 不存在；无法读取生图凭据')
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split(/\r?\n/)
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

/* 正侧视相机条款。器材立在一条水平地平线上，那条线是量测接地点与基线的基准，
   ＊必须＊横贯全幅且水平 —— 3/4 斜视下器物底边是斜的，接地基线无从量起。 */
const CAMERA_SIDE =
  'strictly orthographic side elevation, camera level with the object and looking straight at it ' +
  'from the side, no perspective, no three-quarter angle, no top-down view, ' +
  'the apparatus standing upright on a perfectly horizontal ground line that runs straight across ' +
  'the frame,'

/* 底边必须干净：投影会把轮廓撑大，接地基线就量不准了。 */
const GROUND_RULE =
  'absolutely no cast shadow on the ground and no reflection, only a faint ambient-occlusion ' +
  'darkening where the object meets the ground,'

const style = [
  'photorealistic 3D render of a single school-laboratory mechanics apparatus item,',
  CAMERA_SIDE,
  'object perfectly centred and fully inside the frame with generous margin,',
  'soft studio lighting with one key light from the upper left and gentle fill,',
  'subtle specular highlights, restrained muted palette of steel, brass, varnished wood, ' +
    'dark bakelite and matte plastic,',
  GROUND_RULE,
  'isolated on a fully transparent background, nothing else in frame,',
  'professional product-shot clarity, physically plausible proportions,',
  'no text, no letters, no numbers, no logo, no watermark, no border, no backdrop',
].join(' ')

/** 以 1 m 米尺为参照，保证小车/钩码/木块之间的相对尺度一致。 */
const SCALE_NOTE =
  'All items are rendered at a consistent scale relative to a 1 metre laboratory rule.'

const PARTS = [
  {
    id: 'plank',
    body:
      'a laboratory inclined-plane board: a long flat rectangular plank of varnished wood, ' +
      'lying perfectly level and horizontal, absolutely not tilted and with no perspective, ' +
      'seen exactly from the side so that it appears as a perfect rectangle with a straight ' +
      'horizontal top surface, a straight horizontal bottom surface and both ends cut square ' +
      'and vertical, uniform thickness along its whole length',
  },
  {
    id: 'cart',
    body:
      'a school laboratory dynamics cart seen from the side: a low rectangular matte plastic ' +
      'body with a flat top deck and two small dark wheels touching the ground, the wheels ' +
      'clearly visible below the body',
  },
  {
    id: 'block',
    body:
      'a small laboratory wooden block: a plain rectangular block of varnished wood sitting flat ' +
      'on the ground, seen from the side as a solid rectangle with a crisp bottom edge',
  },
  {
    id: 'ball',
    body:
      'a polished steel laboratory ball resting on the ground, seen from the side as a perfect ' +
      'circle, brushed metal with a soft highlight',
  },
  {
    id: 'weight-hook',
    body:
      'a single slotted laboratory weight with a small hook on top: a short metal cylinder with ' +
      'a turned groove around it and a brass hook rising from its top face, standing perfectly ' +
      'upright on a flat circular base that rests flush on the ground, seen exactly from the side ' +
      'so that its base appears as a straight horizontal line as wide as the cylinder',
  },
  {
    /* 摩擦台的拉力仪器本体：水平横置、钩在右端（接物块受力面）、拉环在左端
       （接手/牵引线）。水平姿态让渲染层按右端锚点贴到物块边缘。 */
    id: 'spring-scale',
    body:
      'a school laboratory spring scale (dynamometer) lying perfectly horizontal, seen from ' +
      'the side: a slim cylindrical metal barrel with a narrow measurement window along its body, ' +
      'a small steel hook extending straight out from its RIGHT end, and a round suspension ring ' +
      'at its LEFT end, the whole instrument level and straight',
  },
  {
    /* 悬挂点器材：夹在画面上方伸入的立杆上，底部带挂环供弹簧/摆线下挂。
       挂环中心即场景锚点。 */
    id: 'support-clamp',
    body:
      'a laboratory boss-head clamp seen from the side: a compact knurled metal clamp body ' +
      'gripping a vertical steel support rod that continues upward out of the top of the frame, ' +
      'with a small open metal ring at the bottom of the clamp for suspending a spring or string, ' +
      'the clamp centred in the frame with the rod entering from above',
  },
  {
    /* 单摆摆角量角器：半圆盘、直边在上、圆心即悬点锚点（顶部中点）。
       盘面向下覆盖摆动弧区。 */
    id: 'protractor',
    body:
      'a semicircular laboratory protractor disc seen exactly face-on: a flat steel ' +
      'semicircle with its straight diameter edge perfectly horizontal across the TOP and the ' +
      'curved arc facing downward, engraved angle scale ticks along the arc with a longer tick ' +
      'at the bottom centre, muted brushed-steel finish, no numbers',
  },
  {
    /* 水平实验导轨：长条滑轨正侧视，顶面是承载直线（块/车站在轨顶），
       渲染按宽度拉伸铺满轨道跨度，锚点取顶面中点。 */
    id: 'track-rail',
    body:
      'a long horizontal laboratory dynamics track seen exactly from the side: a low ' +
      'aluminium rail profile with a perfectly straight flat top surface, a slim vertical ' +
      'web below it and small level feet, uniform height along its whole length, the rail ' +
      'running edge-to-edge across the frame',
  },
  {
    /* 竖直刻度尺：胡克台伸长量读数尺，立在弹簧旁，顶边为挂点高度。
       锚点取尺身顶端中点。 */
    id: 'ruler-vertical',
    body:
      'a tall narrow laboratory ruler standing perfectly vertical, seen face-on: a slim ' +
      'varnished wood ruler with fine engraved tick marks down one edge and a longer tick ' +
      'at each fifth, standing upright with a small metal ferrule cap at its top end',
  },
]

/* ------------------------------------------------------------------ 出图 -- */

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

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
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    if (response.status !== 200) {
      return {
        ok: false,
        status: response.status,
        error: json?.error?.message ?? text.slice(0, 200),
      }
    }
    const item = json?.data?.[0]
    let bytes
    if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
      bytes = Buffer.from(item.b64_json, 'base64')
    } else if (typeof item?.url === 'string') {
      const imageResponse = await fetch(item.url)
      if (!imageResponse.ok)
        return { ok: false, status: imageResponse.status, error: 'download failed' }
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
  const prompt = `${part.body}. ${style} ${SCALE_NOTE}`
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now()
    const result = await requestOnce(prompt)
    const elapsedMs = Date.now() - started
    if (result.ok) return { ...result, prompt, elapsedMs, attempt }
    const retryable = result.status === 0 || result.status >= 500 || result.status === 429
    process.stderr.write(
      `  ! ${part.id} 第 ${attempt} 次失败 (HTTP ${result.status}: ${result.error})\n`,
    )
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
  const targets = only.length > 0 ? PARTS.filter((part) => only.includes(part.id)) : PARTS
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
    writeFileSync(path.join(OUT_DIR, `${part.id}.png`), outcome.bytes)
    writeFileSync(
      path.join(OUT_DIR, `${part.id}.json`),
      `${JSON.stringify(
        {
          id: part.id,
          file: `${part.id}.png`,
          model: MODEL,
          endpoint: BASE_URL,
          bytes: outcome.bytes.length,
          createdAt: new Date().toISOString(),
          elapsedMs: outcome.elapsedMs,
          attempts: outcome.attempt,
          prompt: outcome.prompt,
        },
        null,
        2,
      )}\n`,
    )
    console.log(
      `  ✓ ${part.id}  ${(outcome.bytes.length / 1024).toFixed(0)} KiB  (${(outcome.elapsedMs / 1000).toFixed(1)}s)`,
    )
    return { part, ok: true }
  })

  const ok = results.filter((result) => result.ok).length
  console.log(`\n${ok}/${targets.length} 件器材已生成到 ${OUT_DIR}`)
  if (ok !== targets.length) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
