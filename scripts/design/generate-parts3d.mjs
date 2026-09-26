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

const OUT_DIR = process.env.PARTS3D_OUT
  ? path.join(
      'overlays',
      'harness',
      'files',
      'apps',
      'web',
      'public',
      'physicsos',
      'parts3d',
      process.env.PARTS3D_OUT,
    )
  : path.join('overlays', 'harness', 'files', 'apps', 'web', 'public', 'physicsos', 'parts3d')
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

/* 相机条款两套。轴向器材（两端接线柱要贴到导线上）必须正俯视：3/4 视角下器材
 * 长轴在画面里是斜的，两端接线柱必然不在同一水平线上，渲染层无法把它们同时压
 * 到导线上 —— 这是 studio-v3 首批七件全部返工的原因。 */
const CAMERA_THREE_QUARTER =
  'three-quarter view from above at roughly 45 degrees elevation, orthographic lens,'
const CAMERA_FLAT =
  'strictly top-down 90 degree orthographic view seen from straight above, ' +
  'no perspective foreshortening, no isometric or oblique tilt, no diagonal rotation, ' +
  'the apparatus lying level across the frame parallel to the image edge,'

/* 量接线柱的前提：两个端子在同一水平中线上、位于器材最左与最右、且不被遮挡。 */
const TERMINALS_LEVEL =
  'the two brass binding posts are the leftmost and rightmost points of the apparatus, ' +
  'their centres on one identical horizontal centre line, both fully visible and unoccluded,'

/** 风格串。除相机条款外全套共用；改任何一条都要重生成整批。 */
const style = (camera) =>
  [
    'photorealistic 3D render of a single school-laboratory physics apparatus item,',
    camera,
    'object perfectly centred and fully inside the frame with generous margin,',
    'soft studio lighting with one key light from the upper left and gentle fill,',
    'subtle specular highlights, restrained muted palette of steel, brass, ceramic and dark bakelite,',
    'only a faint ambient-occlusion darkening at the very base, no cast shadow on the ground,',
    'isolated on a fully transparent background, nothing else in frame,',
    'professional product-shot clarity, physically plausible proportions,',
    'no text, no letters, no numbers, no logo, no watermark, no border, no backdrop',
  ].join(' ')

/* 电源类器材的正负极必须看得出来：渲染层在精灵路径上不画极性符号，A/V 与 +/−
 * 全靠照片里的红黑接线柱表达。 */
const POLARITY =
  'one binding post at the right hand end is bright red and the one at the left hand end is ' +
  'black, so the positive terminal is unmistakably on the right,'

/** 以 1cm 接线柱为参照，保证器材之间的相对尺度一致。 */
const SCALE_NOTE = 'All items are rendered at a consistent scale relative to a 1 cm binding post.'

const PARTS = [
  {
    id: 'lamp-off',
    body:
      'a small incandescent lamp bulb with a clear glass envelope and a brass screw base, ' +
      'switched off, the filament inside visible as a thin dark wire',
  },
  {
    id: 'lamp-on',
    body:
      'a small incandescent lamp bulb with a clear glass envelope and a brass screw base, ' +
      'switched on and glowing brightly, a hot yellow-white filament inside casting a warm halo ' +
      'through the glass',
  },
  {
    id: 'resistor',
    body:
      'a laboratory fixed resistor mounted as a bench apparatus: a horizontal ceramic tube ' +
      'wound with dark resistance wire on a small dark wooden base, with one brass binding post ' +
      'at each end of the base, matching the knife switch and rheostat family',
  },
  {
    id: 'rheostat',
    body:
      'a laboratory sliding rheostat, a horizontal ceramic tube wound with bare resistance wire, ' +
      'a bare metal slider riding on a brass guide rail above it, with a vertical metal rod and two ' +
      'binding posts at the base',
  },
  {
    id: 'battery',
    body:
      'a laboratory DC power source, a compact rectangular battery pack in a dark bakelite case ' +
      'with two brass binding posts on top and a small metal label plate, both terminals clearly ' +
      'visible',
  },
  {
    id: 'switch-open',
    body:
      'a laboratory single-pole knife switch mounted on a small dark wooden base, the flat brass ' +
      'blade lifted up and tilted away from the contacts so the circuit is open, two brass binding ' +
      'posts at the two ends of the base',
  },
  {
    id: 'switch-closed',
    body:
      'a laboratory single-pole knife switch mounted on a small dark wooden base, the flat brass ' +
      'blade lowered and lying flat across the two contacts so the circuit is closed, two brass ' +
      'binding posts at the two ends of the base',
  },
  {
    id: 'ammeter',
    body:
      'an analogue panel ammeter in a rectangular black bakelite housing with a brushed metal ' +
      'bezel, a blank white dial face that is completely empty with no markings of any kind, a thin ' +
      'black needle resting near the middle, two brass binding posts at the lower edge',
  },
  {
    id: 'voltmeter',
    body:
      'an analogue panel voltmeter in a rectangular black bakelite housing with a brushed metal ' +
      'bezel, standing upright on a desk; the blank white dial face is completely empty with no ' +
      'markings of any kind and is turned toward the viewer and clearly readable, a thin black ' +
      'needle resting near the middle, two brass binding posts at the lower front edge',
  },
  {
    id: 'terminal',
    body:
      'a single brass laboratory binding post terminal, a short threaded metal post with a ' +
      'knurled nut and a flat base, standing upright',
  },

  /* ---------------------------------------------------------------------------
   * 台面扩充批次（studio-v3）。上面的 10 件是"每种元件一张图"，用到器材栏里就
   * 会出现三个电池长得一模一样的问题 —— 器材栏要像真实的器材盘，同一种元件的
   * 不同规格必须是**看得出区别的实物**。这一批全部落在引擎已有的 6 种元件类型
   * 内（resistor / voltage_source / switch / ammeter / voltmeter /
   * variable_resistor），没有一个新类型，所以每一件都能真解出读数。
   * 风格串与上面完全一致，混在一起不会露馅。
   * ------------------------------------------------------------------------- */
  {
    id: 'cell-aa',
    flat: true,
    polarity: true,
    body:
      'a single AA dry cell battery lying flat on its side and extended along the horizontal, ' +
      'a slim cylindrical zinc-carbon cell wrapped in a plain muted grey-blue paper jacket, ' +
      'one short insulated lead ending in a small brass crocodile clip at each end so that the ' +
      'two clips are the extreme left and right of the apparatus',
  },
  {
    id: 'battery-pack',
    flat: true,
    polarity: true,
    body:
      'a laboratory battery pack laid flat and extended along the horizontal: four cylindrical ' +
      'dry cells held side by side in a dark bakelite carrier, brass connecting straps linking ' +
      'them in series, and one brass binding post at each end of the holder, the two posts being ' +
      'the extreme left and right of the apparatus',
  },
  {
    id: 'supply-dc',
    flat: true,
    polarity: true,
    body:
      'a bench DC power supply unit in a low rectangular steel case seen from directly above, ' +
      'a brushed aluminium panel bearing two large black knurled rotary knobs, one brass binding ' +
      'post at each end of the front edge so that the two posts are the extreme left and right of ' +
      'the apparatus, and a small blank dark display window showing no digits; plain panel with ' +
      'no lettering, no dial markings and no logo',
  },
  {
    id: 'switch-button',
    body:
      'a laboratory push-button switch mounted on a small dark wooden base: a round black ' +
      'bakelite button on a short brass shaft above two brass contact posts, with one brass ' +
      'binding post at each end of the base',
  },
  {
    id: 'resistor-5',
    flat: true,
    body:
      'a laboratory fixed resistor on a small dark wooden base, a horizontal ceramic tube ' +
      'wound with resistance wire and coated in a pale beige vitreous enamel, a single narrow ' +
      'green painted band around the middle of the coating, one brass binding post at each end ' +
      'of the base, the two posts being the extreme left and right of the apparatus',
  },
  {
    id: 'resistor-50',
    flat: true,
    body:
      'a laboratory fixed resistor on a small dark wooden base, a noticeably longer and thicker ' +
      'horizontal ceramic tube wound with resistance wire and coated in a pale beige vitreous ' +
      'enamel, three separate narrow painted bands (orange, orange, black) around the middle of ' +
      'the coating, one brass binding post at each end of the base, the two posts being the ' +
      'extreme left and right of the apparatus',
  },
  {
    id: 'rheostat-50',
    flat: true,
    body:
      'a large laboratory sliding rheostat laid flat and extended along the horizontal, a long ' +
      'thick horizontal ceramic tube densely wound with bare resistance wire, a heavy bare metal ' +
      'slider riding on a brass guide rail with a black bakelite knob, one brass binding post at ' +
      'each end of the base so that the two posts are the extreme left and right of the ' +
      'apparatus, with a longer ceramic tube than a small rheostat, the whole apparatus including ' +
      'both end brackets well inside the frame',
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
  const flat = part.flat === true
  const prompt = [
    `${part.body}.`,
    style(flat ? CAMERA_FLAT : CAMERA_THREE_QUARTER),
    flat ? TERMINALS_LEVEL : undefined,
    part.polarity === true ? POLARITY : undefined,
    SCALE_NOTE,
  ]
    .filter((clause) => clause !== undefined)
    .join(' ')
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
    const file = path.join(OUT_DIR, `${part.id}.png`)
    writeFileSync(file, outcome.bytes)
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

  const ok = results.filter((r) => r.ok).length
  console.log(`\n${ok}/${targets.length} 件器材已生成到 ${OUT_DIR}`)
  /* 非零退出，让"图没出全"不会被静默当成成功。 */
  if (ok !== targets.length) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
