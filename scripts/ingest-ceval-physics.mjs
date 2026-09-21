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
 *   node scripts/ingest-ceval-physics.mjs --retag        # 改关键词表后重新打标
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
 * Stem+option keyword → knowledge point.
 *
 * Granularity matters more than it looks. The assembler scores a candidate's
 * knowledge match at weight 0.45 against the spec row's knowledge point, and
 * those points come from verified annotations — i.e. the teaching group's own
 * fine-grained vocabulary (`流体压强与流速`, `凸透镜成像规律`, `安培力` …),
 * not broad chapter names. An earlier version of this table emitted 13 chapter
 * buckets (`声现象`, `光与光学`); measured against a real blueprint that left
 * every candidate below the 0.55 adapt threshold, so the imported data was
 * inert. The rows below therefore emit specific points in that same style.
 *
 * ORDER IS SIGNIFICANT: first match wins, so specific points precede the
 * broader fallbacks at the end. Every entry is a *proposal* — rows land as
 * `pending` and carry `knowledge-derived-from-stem` in `anomalies`.
 */
const KNOWLEDGE_RULES = [
  /* 声 */
  [/音调|响度|音色|频率决定|振幅决定/, ['声音的特性', '声音特征']],
  [/回声|测距|超声波|次声波/, ['声的利用', '超声波与次声波']],
  [/噪声|隔声|消声|吸声/, ['噪声与防治', '噪声的危害和控制']],
  [/传声|介质|真空不能传声|声速/, ['声现象', '声音的产生与传播']],
  /* 光 */
  [/凸透镜成像|物距|像距|放大|缩小|实像|虚像|照相机|投影仪|放大镜/, ['凸透镜成像规律', '透镜及其应用', '探究凸透镜成像']],
  [/近视|远视|眼镜|焦距|度数/, ['眼睛与眼镜']],
  [/光的反射|入射角|反射角|镜面反射|漫反射/, ['光的反射', '光的反射定律']],
  [/平面镜|成像特点|对称/, ['平面镜成像', '平面镜成像特点']],
  [/光的折射|折射角|池水变浅|筷子|海市蜃楼/, ['光的折射', '光的折射规律']],
  [/色散|色光|三原色|红外线|紫外线/, ['光的色散', '看不见的光']],
  [/全反射|折射率|临界角|干涉|衍射|偏振|双缝/, ['光的波动性', '光的干涉与衍射']],
  /* 热 */
  [/熔化|凝固|熔点|晶体|非晶体/, ['熔点与凝固', '熔化与凝固']],
  [/汽化|液化|蒸发|沸腾|沸点|蒸发放热|液化放热/, ['汽化与液化', '蒸发与沸腾']],
  [/升华|凝华|干冰|霜|雾凇/, ['升华与凝华', '物态变化']],
  [/比热容|热量计算|吸热|放热/, ['比热容', '热量的计算']],
  [/热值|燃料|热机效率|内燃机|冲程|柴油机|汽油机/, ['热机与热值', '内燃机', '热机效率']],
  [/内能|热传递|做功改变内能|分子热运动|扩散/, ['内能', '内能的改变']],
  [/电荷|摩擦起电|同种电荷|验电器/, ['两种电荷', '摩擦起电']],
  [/电流|电压|电阻|欧姆定律|伏安|变阻器/, ['欧姆定律', '伏安法测电阻', '测电阻']],
  [/串联电路|并联电路|串联|并联|干路|支路/, ['串并联电路', '串联电路计算', '并联电路计算', '动态电路分析']],
  [/电功率|额定功率|电能表|千瓦时|焦耳定律|电流热效应/, ['电功率与焦耳定律', '焦耳定律', '电功率']],
  [/家庭电路|保险丝|触电|试电笔|三孔插座|短路/, ['家庭电路与安全用电', '家庭电路', '安全用电']],
  [/磁场|磁感线|通电螺线管|电磁铁|安培定则|奥斯特/, ['电生磁', '电磁铁', '通电螺线管']],
  [/电磁感应|楞次|磁通量|发电机|动生|感生/, ['电磁感应现象', '电磁感应']],
  [/通电导线在磁场|安培力|洛伦兹|左手定则/, ['安培力', '磁场对通电导线的作用']],
  [/带电粒子|电场强度|库仑|电势|电容器|偏转/, ['带电粒子在电场中的运动', '电场强度', '带电粒子偏转']],
  [/复合场|速度选择器|质谱仪|回旋加速器/, ['带电粒子在复合场中的运动', '复合场']],
  [/安培力|磁通量变化|导轨|双棒/, ['电磁感应中的电路与力学', '导体棒切割磁感线']],
  /* 力 */
  [/参照物|机械运动|运动与静止/, ['运动的描述', '参照物', '运动状态']],
  [/速度|路程|平均速度|匀速直线/, ['速度', '平均速度', '速度的计算']],
  [/自由落体|重力加速度/, ['自由落体运动', '自由落体']],
  [/牛顿第一|惯性/, ['牛顿第一定律与惯性', '惯性']],
  [/牛顿第二|合力|加速度|受力分析|正交分解/, ['牛顿第二定律', '受力分析', '牛顿运动定律']],
  [/二力平衡|平衡力|平衡状态/, ['力的平衡', '二力平衡', '平衡力']],
  [/摩擦力|滑动摩擦|静摩擦|粗糙/, ['摩擦力', '滑动摩擦力', '增大减小摩擦']],
  [/压强|受力面积|增大压强|减小压强|固体压强/, ['压强', '增大减小压强的方法', '固体压强']],
  [/液体压强|深度|连通器/, ['液体压强', '液体的压强']],
  [/大气压|托里拆利|沸点与气压/, ['大气压强', '大气压']],
  [/流体|流速|升力|机翼/, ['流体压强与流速', '流体压强']],
  [/浮力|阿基米德|排开|漂浮|悬浮|沉底|浮沉/, ['浮力', '浮沉条件', '阿基米德原理']],
  [/杠杆|力臂|平衡条件/, ['杠杆平衡条件', '杠杆']],
  [/滑轮|机械效率|有用功|额外功|斜面效率/, ['机械效率', '滑轮组机械效率']],
  [/功|功率|做功/, ['功与功率', '功率', '功的计算']],
  [/动能|势能|机械能|能量转化|动能定理/, ['机械能及其转化', '影响动能大小的因素', '动能与势能', '能量转化']],
  [/重力|万有引力|圆周运动|向心力|卫星/, ['万有引力与圆周运动', '万有引力', '圆周运动']],
  [/弹簧|弹性形变|胡克/, ['弹力', '弹簧测力计']],
  [/密度|质量|天平|量筒/, ['密度', '密度的测量']],
  [/力|运动状态|示意图/, ['力与运动', '力的示意图', '力']],
  /* 波 / 电与能源 / 信息 */
  [/波长|波速|简谐|振动图像|波的形成|干涉衍射图样|驻波/, ['机械波', '简谐运动', '波长与频率']],
  [/能源|核能|裂变|聚变|太阳能|可再生|能量守恒/, ['能源与能量守恒', '核能', '能量守恒']],
  [/电磁波|通信|光纤|卫星通信|信号|信息传递/, ['信息的传递', '电磁波']],
  [/原子|质子|中子|核式结构|放射|导体|绝缘体|半导体/, ['原子与材料', '导体与绝缘体']],
  [/估测|生活实际|符合实际|物理量|单位|刻度尺|误差/, ['物理量与测量', '物理量的估测']],
]

/** The four-digit answer letters C-Eval uses. */
const LETTERS = ['A', 'B', 'C', 'D']

const deriveKnowledge = (blob) => {
  for (const [pattern, aliases] of KNOWLEDGE_RULES) {
    if (pattern.test(blob)) return aliases
  }
  return ['物理综合']
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
    /* Re-derive `knowledge` on rows that already exist. Needed whenever the
       keyword table changes: rows are keyed by a deterministic id, so the new
       tag can be patched in place without touching status or review history. */
    retag: args.includes('--retag'),
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
    knowledge: deriveKnowledge(`${stem} ${options.join(' ')}`),
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
  const { base, dryRun, retag } = parseArgs()
  stdout.write(`C-Eval → 题库${dryRun ? '（dry-run）' : retag ? '（retag）' : ''}`
    + `${dryRun ? '' : ` @ ${base}`}\n\n`)

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

  if (retag) {
    /* PUT only `knowledge`: `status`, `reuseModes`, `verifiedBy` and the audit
       trail are the reviewer's record and must survive a retag untouched. */
    let patched = 0
    let skipped = 0
    const failures = []
    for (const item of usable) {
      const response = await fetch(`${base}/physicsos/paper/bank/items/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ knowledge: item.knowledge }),
      })
      if (response.status === 200) { patched++; continue }
      if (response.status === 404) { skipped++; continue }
      const body = await response.json().catch(() => undefined)
      failures.push(`${item.id}: ${response.status} ${body?.error?.code ?? ''}`)
    }
    stdout.write(`\n重新打标 ${patched}｜未入库跳过 ${skipped}｜失败 ${failures.length}\n`)
    for (const failure of failures.slice(0, 10)) stdout.write(`  ✗ ${failure}\n`)
    if (failures.length > 0) process.exitCode = 1
    return
  }

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
