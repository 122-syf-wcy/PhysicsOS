/**
 * 录入 2025 年贵州省中考物理卷（省级统一卷·理综物理部分）到卷库与题库。
 *
 * WHY THIS SOURCE
 * ---------------
 * 卷库已有 2024 省卷；2025 省卷是最新口径（选择 8→7 题、简答 2→3 题），
 * 对 2027 届组卷是最直接的真题底座。物理部分 90 分（理综 150 = 物理 90 +
 * 化学 60），22 题；题干与官方参考答案完整可得：
 *
 * 数据来源与核对方式：
 *   - 题干+答案（主源）：http://www.czwlzx.cn/Item/154369.aspx（初中物理在线，
 *     2025 贵州理综物理试题及答案 word 版，0 点券公开下载）。docx 文本层
 *     逐题转录；〔图〕处为原卷插图/嵌入公式，未转录。
 *   - 同页 3 张扫描预览图（第 1–3 页，覆盖第 1–15 题）与文本层逐字一致，
 *     图文两视图互证。
 *   - 独立流通佐证：https://www.szzx100.cn/Item/151555.aspx（江南汇教育网
 *     「2025年贵州省中考物理试题（含解析）」，独立站点同卷条目；其内容在
 *     会员墙后，未做逐题对照）。
 *   - 全部可推导答案（第 1–7 题选择、18、21、22(1)(3) 等）经物理推导复核
 *     与源文档一致；第 11(2) 问 0.9W 依赖原图像读数，以源文档答案为准。
 *
 * WHAT THIS SCRIPT DOES NOT DO
 * ----------------------------
 * - 不写 `status: 'verified'`：卷、标注与题目全部落 `pending`，由教师在
 *   出卷专区逐条核验后进入组卷池（这是产品的人工闸门，脚本不越过它）。
 * - 不转录图题（6、7、11–22 题附图）：题干保留文字部分，选择题入库时
 *   `anomalies` 如实登记「原图未转录」；主观题只登考点标注。
 *
 * USAGE
 * -----
 *   node scripts/ingest-gz-2025-physics.mjs --username admin --password …
 *   node scripts/ingest-gz-2025-physics.mjs --base http://127.0.0.1:3099 …
 *   node scripts/ingest-gz-2025-physics.mjs --dry-run      # 只打印计划
 */
import process, { stdout } from 'node:process'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const base = argOf('base', 'http://127.0.0.1:3080')
const username = argOf('username', process.env.PHYSICSOS_INGEST_USER)
const password = argOf('password', process.env.PHYSICSOS_INGEST_PASSWORD)
const dryRun = args.includes('--dry-run')

const SOURCE_ID = 'gz-zk-2025-lizong-physics'
const SOURCE_URLS = [
  'http://www.czwlzx.cn/Item/154369.aspx',
  'https://www.szzx100.cn/Item/151555.aspx',
].join(' ')

const sourcePaper = {
  id: SOURCE_ID,
  level: 'zhongkao',
  subject: 'physics',
  year: 2025,
  examName: '2025 年贵州省初中学业水平考试·理科综合（物理部分）',
  kind: 'real',
  region: '贵州',
  totalScore: 90,
  pageCount: 8,
  evidenceTier: 'manual-transcript',
  sourceRef: `word 版文本层逐题转录 + 同页扫描图互证：${SOURCE_URLS}`,
  enteredBy: 'ingest-gz-2025',
  note:
    '省级统一命题第二年物理部分 90 分，22 题；选择 7 题（第 7 题唯一多选，漏选得 1 分）、' +
    '简答 3 题为与 2024 卷的结构差异。题干与答案取自公开 word 版文本层，前 15 题与扫描图逐字一致；' +
    '可推导答案经物理复核一致；图题原图未转录。含解析版独立流通条目见江南汇教育网（会员墙，未逐题对照）。',
}

/** 22 题的知识点标注；`stem` 为题干摘要（图题只记文字部分）。 */
const annotations = [
  {
    questionNo: '1',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '质量的估测',
    knowledgeSecondary: ['质量'],
    ability: '识记',
    stem: '你的质量（俗称体重）与下列质量值最接近的是（50kg）。',
  },
  {
    questionNo: '2',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '分子热运动',
    knowledgeSecondary: ['扩散'],
    ability: '理解',
    stem: '等量白糖放入热水和冷水，热水变甜更快——影响快慢的主要因素是温度。',
  },
  {
    questionNo: '3',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '声音的特性',
    knowledgeSecondary: ['音调'],
    ability: '理解',
    stem: '侗族大歌「众低独高」的「低」「高」主要指声音的音调。',
  },
  {
    questionNo: '4',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '物态变化',
    knowledgeSecondary: ['汽化'],
    ability: '理解',
    stem: '《天工开物》凿井取盐：去水取盐过程中水发生的物态变化是汽化。',
  },
  {
    questionNo: '5',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '内能',
    knowledgeSecondary: ['热传递'],
    ability: '理解',
    stem: '高温餐具放上餐桌前垫隔热垫，主要从热传递方面防止桌面损坏。',
  },
  {
    questionNo: '6',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '磁现象',
    knowledgeSecondary: ['磁体与磁极'],
    ability: '理解',
    stem: '铁棒靠近小磁针：出现哪一现象便能证明铁棒有磁性（N 极被排斥）。（原图未转录）',
  },
  {
    questionNo: '7',
    kind: 'choice-multi',
    score: 3,
    knowledgePrimary: '力与运动',
    knowledgeSecondary: ['合力', '动能与势能'],
    ability: '分析',
    stem: '雨滴由静止下落，合力随时间从 F₁ 减小到 F₂：判断阻力增大与能量变化（多选 AD）。（原图未转录）',
  },
  {
    questionNo: '8',
    kind: 'blank',
    score: 2,
    knowledgePrimary: '牛顿第一定律',
    knowledgeSecondary: ['惯性'],
    ability: '理解',
    stem: '公交车起步前提示「请站稳扶好」，防止乘客因惯性倾倒。',
  },
  {
    questionNo: '9',
    kind: 'blank',
    score: 2,
    knowledgePrimary: '密度',
    knowledgeSecondary: ['密度与材料'],
    ability: '理解',
    stem: '轻量化材料在体积相同时质量更小，是因为密度较小。',
  },
  {
    questionNo: '10',
    kind: 'blank',
    score: 2,
    knowledgePrimary: '原子结构',
    knowledgeSecondary: ['夸克'],
    ability: '识记',
    stem: '原子核、质子、中子、夸克中空间尺度最小的是夸克。',
  },
  {
    questionNo: '11',
    kind: 'blank',
    score: 4,
    knowledgePrimary: '电压与电压表',
    knowledgeSecondary: ['欧姆定律', '电功率'],
    ability: '分析',
    stem: '电压表 V₁ 测灯泡两端电压；滑片从最右移到最左，由 U-I 图像求变阻器取半阻时的功率（0.9W）。（原图未转录）',
  },
  {
    questionNo: '12',
    kind: 'drawing',
    score: 2,
    knowledgePrimary: '弹力',
    knowledgeSecondary: ['力的示意图'],
    ability: '应用',
    stem: '茶杯静止于水平桌面，画出桌面对茶杯支持力 F 的示意图。（原图未转录）',
  },
  {
    questionNo: '13',
    kind: 'drawing',
    score: 2,
    knowledgePrimary: '光的反射',
    knowledgeSecondary: ['光路图'],
    ability: '应用',
    stem: '一束阳光经窗玻璃反射进入眼睛，画出反射光线对应的入射光线。（原图未转录）',
  },
  {
    questionNo: '14',
    kind: 'drawing',
    score: 2,
    knowledgePrimary: '电路设计',
    knowledgeSecondary: ['串并联', '电功率'],
    ability: '应用',
    stem: '可调温电热垫：拨动滑动键切换 a、b、c 三触点挡位（U=4.8V，两电阻丝阻值见原卷嵌入公式），完成电路设计。（原图未转录）',
  },
  {
    questionNo: '15',
    kind: 'short-answer',
    score: 3,
    knowledgePrimary: '能量转化',
    knowledgeSecondary: ['太阳能利用'],
    ability: '应用',
    stem: '光电转化玻璃既能作普通玻璃又能将太阳能转化为电能：提出两条应用设想。',
  },
  {
    questionNo: '16',
    kind: 'short-answer',
    score: 3,
    knowledgePrimary: '流体压强与流速',
    knowledgeSecondary: ['流体压强'],
    ability: '应用',
    stem: '灭火喷水枪枪口向外喷高速水流将屋内烟、气「带走」：用流速与压强关系解释原因。',
  },
  {
    questionNo: '17',
    kind: 'short-answer',
    score: 3,
    knowledgePrimary: '功和机械能',
    knowledgeSecondary: ['能量守恒'],
    ability: '分析',
    stem: '木块从 A 滑到 B 恰好停止（初动能 60J）：判断「匀速推回」与「推一段后撤力滑回」两种设想是否可行并说理。（原图未转录）',
  },
  {
    questionNo: '18',
    kind: 'experiment',
    score: 8,
    knowledgePrimary: '伏安法测电阻',
    knowledgeSecondary: ['滑动变阻器', '额定电压'],
    ability: '探究',
    experimentType: '课标必做',
    stem: '测量小灯泡（2.5V）正常发光时的电阻：开关状态、变阻器接线柱选择、正常发光判定与电流表读数。',
  },
  {
    questionNo: '19',
    kind: 'experiment',
    score: 10,
    knowledgePrimary: '光的折射',
    knowledgeSecondary: ['折射规律', '法线'],
    ability: '探究',
    experimentType: '课标必做',
    stem: '探究光的折射特点：激光经空气与玻璃砖的光路中识别反射/折射光、作法线辅助线、判断入射端并说理。',
  },
  {
    questionNo: '20',
    kind: 'experiment',
    score: 10,
    knowledgePrimary: '探究实验设计',
    knowledgeSecondary: ['控制变量', '动能与势能'],
    ability: '探究',
    experimentType: '拓展探究',
    stem: '广告牌底座宽度与倾倒探究：摆球能量转化、控制撞击作用相同、实验结论评价与改进方案设计。',
  },
  {
    questionNo: '21',
    kind: 'calculation',
    score: 8,
    knowledgePrimary: '欧姆定律',
    knowledgeSecondary: ['串联电路', '电功率'],
    ability: '应用',
    stem: '电源 3V、R₁=10Ω、电流表示数 0.2A：求通过 R₁ 的电流、R₁ 两端电压与电路总功率。',
  },
  {
    questionNo: '22',
    kind: 'calculation',
    score: 8,
    knowledgePrimary: '浮力',
    knowledgeSecondary: ['阿基米德原理', '物体的浮沉条件'],
    ability: '分析',
    stem: '制作浮力秤：漂浮条件、调整刻度条件、1cm 刻度对应 50g 的换算、粗细不均瓶身刻度的误差分析。',
  },
]

/** 7 道选择题入库（题干 + 选项 + 官方答案 + 解析）；图题 Q6/Q7 附图以 anomalies 登记。 */
const bankItems = [
  {
    id: 'gz-zk-2025-q1',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '识记',
    knowledge: ['质量的估测', '质量'],
    stem: '你的质量（俗称体重）与下列各质量值最接近的是（　　）',
    options: ['A．50t', 'B．50kg', 'C．50g', 'D．50mg'],
    answer: 'B',
    analysis:
      '中学生质量约 50kg；50t 是满载卡车量级，50g 是一个鸡蛋量级，50mg 远小于任何人体质量。',
  },
  {
    id: 'gz-zk-2025-q2',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['分子热运动', '扩散'],
    stem: '将等量白糖分别放入同样多的热水和冷水中，在不搅拌的情况下，热水变甜得更快。这里影响水变甜快慢的主要因素是（　　）',
    options: ['A．体积', 'B．质量', 'C．温度', 'D．密度'],
    answer: 'C',
    analysis:
      '白糖溶解并扩散到整杯水是分子热运动（扩散）的表现；温度越高分子运动越剧烈，扩散越快，热水先变甜。',
  },
  {
    id: 'gz-zk-2025-q3',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['声音的特性', '音调'],
    stem: '侗族大歌有其独有的「众低独高」演唱特色，即多人演唱低声部，一至三人轮换领唱高声部，这里的「低」「高」主要是指声音的（　　）',
    options: ['A．声速', 'B．音色', 'C．响度', 'D．音调'],
    answer: 'D',
    analysis:
      '声音的「高」「低」指音调，由发声体振动的频率决定；声速由介质决定，音色是辨别发声体的依据，响度是声音的强弱。',
  },
  {
    id: 'gz-zk-2025-q4',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['物态变化', '汽化'],
    stem: '《天工开物》里有凿井取盐的记载，大意是凿出盐井并舀出含盐卤水入锅熬煮，去除水分后便可得到盐。去水取盐的过程中，水发生的物态变化是（　　）',
    options: ['A．液化', 'B．熔化', 'C．汽化', 'D．凝华'],
    answer: 'C',
    analysis:
      '熬煮使液态水变成水蒸气离开，液态→气态是汽化；液化是气态→液态，熔化是固态→液态，凝华是气态→固态。',
  },
  {
    id: 'gz-zk-2025-q5',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['内能', '热传递'],
    stem: '为保护餐桌桌面，在将盛有高温菜、汤的餐具放上餐桌前，往往先在桌面上放置隔热垫，这主要是从下列哪个方面防止桌面遭受损坏（　　）',
    options: ['A．静电', 'B．热传递', 'C．压力', 'D．噪声'],
    answer: 'B',
    analysis:
      '高温餐具会通过热传递把内能传给桌面；隔热垫是热的不良导体，减慢热传递，防止桌面因受高温而损坏。',
  },
  {
    id: 'gz-zk-2025-q6',
    kind: 'choice-single',
    score: 3,
    difficulty: 'medium',
    ability: '理解',
    knowledge: ['磁现象', '磁体与磁极'],
    stem: '（原题附图）如图所示，为判断一根铁棒是否有磁性，用铁棒靠近置于水平桌面上的小磁针进行检验，当出现以下哪一现象，便能证明铁棒有磁性（　　）',
    options: [
      'A．将铁棒一端靠近小磁针N极，N极被排斥',
      'B．将铁棒一端靠近小磁针N极，N极被吸引',
      'C．将铁棒两端分别靠近小磁针N极，N极均被吸引',
      'D．将铁棒同一端分别靠近小磁针N、S极，两极均被吸引',
    ],
    answer: 'A',
    analysis:
      '排斥是磁体特有的相互作用：只有磁体的 N 极才会排斥小磁针的 N 极（A 对）。吸引无法区分磁体与铁棒——磁体吸引铁、钴、镍，无磁性的铁棒也会被磁针吸引（B、C、D 均不能证明）。',
  },
  {
    id: 'gz-zk-2025-q7',
    kind: 'choice-multi',
    score: 3,
    difficulty: 'medium',
    ability: '分析',
    knowledge: ['力与运动', '合力', '动能与势能'],
    stem: '（多选，原题附合力—时间图像）设一雨滴从高空由静止竖直下落，从开始下落计时，一段时间内雨滴所受合力随时间变化的关系如图所示。整个过程仅考虑雨滴受重力和空气阻力作用，忽略雨滴质量变化，下列判断正确的是（　　）',
    options: [
      'A．0~t₁时间内，雨滴所受空气阻力逐渐增大',
      'B．t₁时刻雨滴所受空气阻力大小为F₂',
      'C．0~t₁时间内，雨滴的动能保持不变',
      'D．0~t₁时间内，雨滴的机械能逐渐减小',
    ],
    answer: 'AD',
    analysis:
      '重力不变而合力减小，说明阻力逐渐增大（A 对）。t₁ 时刻合力为 F₂，阻力 = 重力 − F₂，不等于 F₂（B 错）。合力始终大于零，雨滴一直加速，动能增大（C 错）。下落中重力势能转化为动能和内能（克服阻力做功），机械能减小（D 对）。',
  },
]

const login = async () => {
  const response = await fetch(`${base}/physicsos/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ username, password, rememberDevice: false }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined)
    throw new Error(`登录失败 ${response.status} ${body?.error?.code ?? ''}`)
  }
  const cookie = response.headers.get('set-cookie')
  if (cookie === null) throw new Error('登录成功但未返回会话 cookie')
  return cookie.split(';')[0]
}

const post = async (path, body, cookie) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => undefined) }
}

if (dryRun) {
  stdout.write(`计划：1 张原卷 + ${annotations.length} 条考点标注 + ${bankItems.length} 道选择题\n`)
  stdout.write(
    `原卷：${sourcePaper.examName}（${sourcePaper.totalScore} 分，${sourcePaper.pageCount} 页）\n`,
  )
  stdout.write('全部落 pending，由教师核验。dry-run 未写入。\n')
  process.exit(0)
}

if (username === undefined || password === undefined) {
  stdout.write(
    '需要 --username/--password（或 PHYSICSOS_INGEST_USER/PASSWORD）以教师及以上身份登录。\n',
  )
  process.exit(2)
}

const cookie = await login()
stdout.write(`登录 ${username} @ ${base}\n`)

const sourceResult = await post('/physicsos/paper/sources', sourcePaper, cookie)
stdout.write(
  sourceResult.status === 201
    ? `原卷已登记：${sourcePaper.id}\n`
    : `原卷登记返回 ${sourceResult.status}（${sourceResult.body?.error?.code ?? '已存在'}）——继续\n`,
)

let annotationCreated = 0
let annotationDup = 0
for (const [index, item] of annotations.entries()) {
  const result = await post(
    `/physicsos/paper/sources/${SOURCE_ID}/annotations`,
    {
      id: `${SOURCE_ID}-a${String(index + 1).padStart(2, '0')}`,
      sourcePaperId: SOURCE_ID,
      questionNo: item.questionNo,
      subject: 'physics',
      kind: item.kind,
      score: item.score,
      knowledgePrimary: item.knowledgePrimary,
      knowledgeSecondary: item.knowledgeSecondary,
      ability: item.ability,
      ...(item.experimentType === undefined ? {} : { experimentType: item.experimentType }),
      stem: item.stem,
      answerSource: 'manual-transcript',
      reviewer: 'ingest-gz-2025',
    },
    cookie,
  )
  if (result.status === 201) annotationCreated += 1
  else if (result.status === 409) annotationDup += 1
  else
    stdout.write(
      `  ✗ 标注 ${item.questionNo}: ${result.status} ${result.body?.error?.code ?? ''}\n`,
    )
}
stdout.write(
  `考点标注：新建 ${annotationCreated}｜已存在 ${annotationDup}｜共 ${annotations.length}\n`,
)

let bankCreated = 0
let bankDup = 0
for (const item of bankItems) {
  const result = await post(
    '/physicsos/paper/bank/items',
    {
      id: item.id,
      sourcePaperId: SOURCE_ID,
      level: 'zhongkao',
      subject: 'physics',
      kind: item.kind,
      knowledge: item.knowledge,
      ability: item.ability,
      difficulty: item.difficulty,
      score: item.score,
      stem: item.stem,
      options: item.options,
      answer: {
        result: item.answer,
        steps: [item.analysis],
        gradingPoints: [
          {
            text: `官方答案 ${item.answer}${item.kind === 'choice-multi' ? '（漏选得 1 分，错选不得分）' : ''}`,
            score: item.score,
          },
        ],
      },
      answerTier: 'manual-transcript',
      sourceLabel: '2025 年贵州省中考理综（物理部分）',
      sourceQuestionNo: item.id.replace('gz-zk-2025-q', ''),
      sourceUrl: SOURCE_URLS.split(' ')[0],
      anomalies: ['图题为原卷附图，未转录进题干'],
      reuseModes: ['verbatim', 'adapt'],
      enteredBy: 'ingest-gz-2025',
    },
    cookie,
  )
  if (result.status === 201) bankCreated += 1
  else if (result.status === 409) bankDup += 1
  else stdout.write(`  ✗ 题目 ${item.id}: ${result.status} ${result.body?.error?.code ?? ''}\n`)
}
stdout.write(`题库：新建 ${bankCreated}｜已存在 ${bankDup}｜共 ${bankItems.length}\n`)
stdout.write(
  '\n全部为 status=pending：请到出卷专区「真题资料库」核验原卷，' +
    '再批量核验题库条目后它们才进入组卷池。\n',
)
