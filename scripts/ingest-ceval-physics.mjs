/**
 * Ingest C-Eval physics questions into the PhysicsOS 题库.
 *
 * WHY THIS SOURCE
 * ---------------
 * The 题库 was built to be fed by teacher-verified questions transcribed from
 * real papers, but it shipped with 4 items — too few for the assembly algorithm
 * to demonstrate anything. C-Eval (`ceval/ceval-exam`) is an openly published
 * Chinese examination question set with a `middle_school_physics` and a
 * `high_school_physics` subject, i.e. exactly the 中考/高考 range this product
 * targets. It is the only *licensed, machine-readable* source of real Chinese
 * physics questions reachable from this environment — commercial question banks
 * (学科网 / 百度文库 / 道客巴巴) are paywalled, and provincial exam authorities do
 * not publish full papers.
 *
 * WHAT THIS DATA IS NOT
 * ---------------------
 * These are **not** Guizhou 真题 and they are **not** verified against any paper.
 * Every row is therefore ingested as:
 *
 *   - `status: 'pending'`  — the service's own default; a teacher must verify it
 *   - `reuseModes: ['adapt']` — never `verbatim`: the assembler may use one as a
 *     skeleton for a rewritten question, but must never print it as-is as though
 *     it were verified paper content
 *   - `answerTier: 'web-public'` — the weakest tier that still names a source
 *   - `anomalies` — every field this source does not supply is listed there, so
 *     the review UI shows the teacher precisely what is missing
 *
 * C-Eval supplies only stem / A-D / answer / explanation. Knowledge point,
 * difficulty, ability and score are NOT in the source; the script derives a
 * knowledge tag from the stem with the documented keyword table below and marks
 * it `knowledge-derived-from-stem`, and uses named defaults for the rest. Those
 * derivations are proposals for a human to accept or reject — not claims.
 *
 * LICENCE
 * -------
 * C-Eval is CC BY-NC-SA 4.0. PhysicsOS is PolyForm-Noncommercial-1.0.0, so the
 * non-commercial and share-alike terms are compatible; attribution is recorded
 * in `sourceLabel`/`sourceUrl` on every row and in the repository NOTICE.
 * Upstream: https://huggingface.co/datasets/ceval/ceval-exam
 *
 * USAGE
 * -----
 *   node scripts/ingest-ceval-physics.mjs                 # ingest into :3080
 *   node scripts/ingest-ceval-physics.mjs --dry-run       # map + report only
 *   node scripts/ingest-ceval-physics.mjs --base http://127.0.0.1:3099
 */
import process, { stdout } from 'node:process'

const DATASET = 'ceval/ceval-exam'
const ROWS_ENDPOINT = 'https://datasets-server.huggingface.co/rows'
const UPSTREAM = 'https://huggingface.co/datasets/ceval/ceval-exam'
const PAGE = 100
/** Politeness delay between pages — the public endpoint rate-limits bursts. */
const PAGE_DELAY_MS = 1200
const FETCH_TIMEOUT_MS = 60_000

/** C-Eval subject → PhysicsOS level. */
const SUBJECTS = [
  { config: 'middle_school_physics', level: 'zhongkao', label: '初中物理' },
  { config: 'high_school_physics', level: 'gaokao', label: '高中物理' },
]
const SPLITS = ['val', 'test', 'dev']

/**
 * Stem keyword → knowledge point. Deliberately shallow and readable: it is a
 * *proposal* attached to a `pending` row, and `knowledge-derived-from-stem` in
 * `anomalies` says so. Order matters — the first hit wins, so the more specific
 * topics come first.
 */
const KNOWLEDGE_RULES = [
  [/欧姆定律|电流|电压|电阻|串联|并联|电路|电源|电功率|电能表|焦耳|用电|保险丝|触电|电笔|家庭电路|短路|千瓦时/, '电路与欧姆定律'],
  [/磁场|电磁感应|安培|洛伦兹|通电导线|楞次|磁通量|发电机|电动机|电磁铁|奥斯特|磁感线|地磁场/, '磁场与电磁感应'],
  [/电场|电荷|库仑|电容|电势|静电|带电粒子|摩擦起电|带电小球|排斥|吸引/, '静电场'],
  [/光的反射|光的折射|平面镜|凸透镜|凹透镜|透镜|成像|焦点|焦距|折射率|全反射|干涉|衍射|偏振|色光|色散|红外线|紫外线|望远镜|显微镜|影子|倒影/, '光与光学'],
  [/音调|响度|音色|回声|超声波|次声波|噪声|声现象|传声/, '声现象'],
  [/熔化|凝固|汽化|液化|升华|凝华|物态变化|温度|内能|比热容|热值|热量|热机|冲程|内燃机|分子|扩散|蒸发|沸腾|露珠|霜|雾|白气|热传递/, '热与内能'],
  [/参照物|速度|路程|匀速|变速|静止|运动的描述|直线运动|平均速度/, '运动的描述'],
  [/牛顿|惯性|摩擦|重力|弹力|合力|二力平衡|平衡力|质量|密度|压强|浮力|杠杆|滑轮|机械效率|做功|功率|动能|势能|机械能|大气压|弹簧测力计|连通器|运动状态|超重|失重/, '力与运动'],
  [/波长|频率|波速|振幅|机械波|声波/, '机械波'],
  [/能量守恒|能源|核能|太阳能|可再生|裂变|聚变|能量转化/, '能源与能量守恒'],
  [/电磁波|通信|卫星|光纤|网络|信号|信息传递|电磁屏蔽/, '信息的传递'],
  [/原子|质子|中子|核式结构|放射|导体|绝缘体|半导体/, '原子与电学基础'],
  [/估测|生活实际|符合实际|物理量|单位|测量仪器|刻度尺|天平|量筒|误差/, '物理量与测量'],
]

/** The four-digit answer letters C-Eval uses. */
const LETTERS = ['A', 'B', 'C', 'D']

const deriveKnowledge = (blob) => {
  for (const [pattern, knowledge] of KNOWLEDGE_RULES) {
    if (pattern.test(blob)) return knowledge
  }
  return '物理综合'
}

/** Fields this source does not provide; surfaced verbatim in the review UI. */
const ANOMALIES = [
  'no-official-knowledge-tag',
  'knowledge-derived-from-stem',
  'no-difficulty-label',
  'no-ability-label',
  'no-score-label',
  'no-verified-source-paper',
]

const parseArgs = () => {
  const args = process.argv.slice(2)
  const baseIndex = args.indexOf('--base')
  return {
    base: baseIndex === -1 ? 'http://127.0.0.1:3080' : args[baseIndex + 1],
    dryRun: args.includes('--dry-run'),
  }
}

/**
 * GET with retry. The public datasets-server rate-limits bursts (429) and
 * occasionally 5xx-es; a page-per-second crawl over six config/split pairs is
 * enough to trip it, so back off exponentially rather than failing the run.
 */
const fetchJson = async (url, attempt = 1) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (response.ok) return response.json()
  if ((response.status === 429 || response.status >= 500) && attempt <= 4) {
    const waitMs = 2000 * 2 ** (attempt - 1)
    stdout.write(`  … ${response.status}，${waitMs / 1000}s 后重试（第 ${attempt} 次）\n`)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    return fetchJson(url, attempt + 1)
  }
  throw new Error(`${response.status} ${url}`)
}

/** Every row of one config/split, paged. */
const fetchSplit = async (config, split) => {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const url = `${ROWS_ENDPOINT}?dataset=${encodeURIComponent(DATASET)}`
      + `&config=${config}&split=${split}&offset=${offset}&length=${PAGE}`
    const page = await fetchJson(url)
    const batch = page.rows ?? []
    rows.push(...batch.map(entry => entry.row))
    if (batch.length < PAGE) return rows
    await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS))
  }
}

/**
 * One C-Eval row → a `POST /bank/items` body.
 *
 * `score` gets a named default rather than a guess dressed as data, and the
 * answer carries the chosen option's text so the teacher does not have to
 * cross-reference the letter by hand.
 */
const toBankItem = (row, { config, level }, split) => {
  const stem = String(row.question ?? '').trim()
  const options = LETTERS
    .filter(letter => typeof row[letter] === 'string' && row[letter].trim() !== '')
    .map(letter => `${letter}. ${String(row[letter]).trim()}`)
  const answerLetter = String(row.answer ?? '').trim().toUpperCase()
  const answerText = LETTERS.includes(answerLetter) ? String(row[answerLetter] ?? '').trim() : ''
  const explanation = String(row.explanation ?? '').trim()

  return {
    id: `ceval-${config}-${split}-${row.id}`,
    level,
    subject: 'physics',
    kind: 'choice-single',
    /* Match against stem + options: cross-topic stems ("下列说法正确的是")
       carry their subject matter in the choices, so stem-only matching left
       a third of the corpus untagged. */
    knowledge: [deriveKnowledge(`${stem} ${options.join(' ')}`)],
    ability: '理解',
    difficulty: 'medium',
    score: 3,
    stem,
    options,
    answer: {
      result: answerText === '' ? answerLetter : `${answerLetter}. ${answerText}`,
      steps: explanation === '' ? [] : [explanation],
      gradingPoints: [],
    },
    answerTier: 'web-public',
    sourceLabel: `C-Eval ${config}（${split}）`,
    sourceQuestionNo: String(row.id ?? ''),
    sourceUrl: UPSTREAM,
    anomalies: [...ANOMALIES, ...(explanation === '' ? ['no-explanation'] : [])],
    reuseModes: ['adapt'],
    enteredBy: 'ceval-ingest',
  }
}

const main = async () => {
  const { base, dryRun } = parseArgs()
  stdout.write(`C-Eval → 题库${dryRun ? '（dry-run）' : ` @ ${base}`}\n\n`)

  const collected = []
  for (const subject of SUBJECTS) {
    for (const split of SPLITS) {
      const rows = await fetchSplit(subject.config, split)
      stdout.write(`  ${subject.config}/${split}: ${rows.length} 行\n`)
      collected.push(...rows.map(row => toBankItem(row, subject, split)))
    }
  }

  /* A blank stem or a missing answer would be rejected by the wire schema; drop
     them here so the run reports a real number instead of a wall of 400s. */
  const usable = collected.filter(item =>
    item.stem.length > 0 && item.options.length >= 2
    && /^[A-D]$/.test(item.answer.result.slice(0, 1)))
  const skipped = collected.length - usable.length
  stdout.write(`\n映射 ${collected.length} 行 → 可用 ${usable.length}（丢弃 ${skipped}：题干空/选项不足/无答案）\n`)

  if (dryRun) {
    stdout.write('\n样例：\n')
    stdout.write(`${JSON.stringify(usable[0], null, 2)}\n`)
    stdout.write('\ndry-run：未写入。\n')
    return
  }

  let created = 0
  let duplicates = 0
  const failures = []
  for (const item of usable) {
    const response = await fetch(`${base}/physicsos/paper/bank/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(item),
    })
    if (response.status === 201) { created++; continue }
    const body = await response.json().catch(() => undefined)
    if (response.status === 409) { duplicates++; continue }
    failures.push(`${item.id}: ${response.status} ${body?.error?.code ?? ''}`)
  }

  stdout.write(`\n新建 ${created}｜已存在 ${duplicates}｜失败 ${failures.length}\n`)
  for (const failure of failures.slice(0, 10)) stdout.write(`  ✗ ${failure}\n`)
  if (failures.length > 10) stdout.write(`  … 另有 ${failures.length - 10} 条\n`)
  stdout.write('\n全部条目为 status=pending、reuseModes=[adapt]，'
    + `需教师在出卷专区「真题资料库」逐条核验后才会参与组卷。\n`)
  if (failures.length > 0) process.exitCode = 1
}

await main()
