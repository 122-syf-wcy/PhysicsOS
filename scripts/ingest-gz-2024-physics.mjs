/**
 * 录入 2024 年贵州省中考物理卷（省级统一卷·理综物理部分）到卷库与题库。
 *
 * WHY THIS SOURCE
 * ---------------
 * 卷库此前只有 4 张卷，缺口是「可核验的真实卷源」。2024 年贵州中考首次省级
 * 统一命题，物理部分 90 分（理综 150 = 物理 90 + 化学 60），22 题；题干与
 * 答案在公开转录页上完整可得，且两处独立来源的答案互相一致（见下），因此
 * 可以逐题核对后录入，而不是编。
 *
 * 数据来源（两处独立转录，交叉核对）：
 *   - 题干与答案：http://www.czwlzx.cn/Item/151970.aspx（初中物理在线，2024
 *     贵州理综物理试题及答案）
 *   - 题干预览 + 答案：https://m.51jiaoxi.com/doc-15928872.html
 *   - 答案对照页（黔东南卷答案，与省级卷答案一致）：
 *     http://www.51jiaoxi.com/doc-15975271.html
 *
 * 两处答案的唯一差异是第 12 题写作 `8:2` 与 `4:1` —— 同一比值的两种写法。
 *
 * WHAT THIS SCRIPT DOES NOT DO
 * ----------------------------
 * - 不写 `status: 'verified'`：卷、标注与题目全部落 `pending`，由教师在
 *   出卷专区逐条核验后进入组卷池（这是产品的人工闸门，脚本不越过它）。
 * - 不转录图题（13–15 题）的图形：题干保留文字部分，`anomalies` 里如实
 *   登记「原图未转录」。这几题不进题库。
 *
 * USAGE
 * -----
 *   node scripts/ingest-gz-2024-physics.mjs --username admin --password …
 *   node scripts/ingest-gz-2024-physics.mjs --base http://127.0.0.1:3092 …
 *   node scripts/ingest-gz-2024-physics.mjs --dry-run      # 只打印计划
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

const SOURCE_ID = 'gz-zk-2024-lizong-physics'
const SOURCE_URLS = [
  'http://www.czwlzx.cn/Item/151970.aspx',
  'https://m.51jiaoxi.com/doc-15928872.html',
  'http://www.51jiaoxi.com/doc-15975271.html',
].join(' ')

const sourcePaper = {
  id: SOURCE_ID,
  level: 'zhongkao',
  subject: 'physics',
  year: 2024,
  examName: '2024 年贵州省初中学业水平考试·理科综合（物理部分）',
  kind: 'real',
  region: '贵州',
  totalScore: 90,
  pageCount: 12,
  evidenceTier: 'manual-transcript',
  sourceRef: `公开转录页逐题核对：${SOURCE_URLS}`,
  enteredBy: 'ingest-gz-2024',
  note:
    '省级统一命题首年（2024）物理部分 90 分，22 题。题干与答案在公开转录页逐题核对，' +
    '两处独立来源答案一致（第 12 题 `8:2` 与 `4:1` 为同一比值）。图题（13–15）图形未转录。',
}

/** 22 题的知识点标注；`stem` 为题干摘要（图题只记文字部分）。 */
const annotations = [
  {
    questionNo: '1',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '温度与内能',
    knowledgeSecondary: ['温度'],
    ability: '识记',
    stem: '刚出锅的粽子很烫，「烫」是形容粽子的什么物理量。',
  },
  {
    questionNo: '2',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '核能',
    knowledgeSecondary: ['能源分类', '核裂变'],
    ability: '识记',
    stem: '「华龙一号」核电机组发电利用核裂变释放的哪种能量。',
  },
  {
    questionNo: '3',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '声音的特性',
    knowledgeSecondary: ['音色'],
    ability: '理解',
    stem: '人耳辨别鸟声与琴声的主要依据。',
  },
  {
    questionNo: '4',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '内能的利用',
    knowledgeSecondary: ['热机'],
    ability: '理解',
    stem: '下列机器设备中利用内能工作的是哪一个。',
  },
  {
    questionNo: '5',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '运动状态',
    knowledgeSecondary: ['惯性'],
    ability: '理解',
    stem: '足球在空中划过弧线飞向球门过程中的受力与运动状态分析。',
  },
  {
    questionNo: '6',
    kind: 'choice-single',
    score: 3,
    knowledgePrimary: '光的反射',
    knowledgeSecondary: ['平面镜成像'],
    ability: '理解',
    stem: '《淮南万毕术》记载的水盆与平面镜观察墙外景物，利用了什么现象。',
  },
  {
    questionNo: '7',
    kind: 'choice-multi',
    score: 3,
    knowledgePrimary: '动态电路',
    knowledgeSecondary: ['欧姆定律', '电功率'],
    ability: '分析',
    stem: '电源 9V、灯泡额定 6V 的电路，移动滑片时对灯泡电阻、实际功率与变阻器取值范围的分析。',
  },
  {
    questionNo: '8',
    kind: 'choice-multi',
    score: 3,
    knowledgePrimary: '杠杆平衡',
    knowledgeSecondary: ['杠杆'],
    ability: '分析',
    stem: '条凳一端受压上翘的杠杆模型分析。',
  },
  {
    questionNo: '9',
    kind: 'blank',
    score: 2,
    knowledgePrimary: '压强',
    knowledgeSecondary: ['增大减小压强的方法'],
    ability: '应用',
    stem: '破冰艏通过增大还是减小对冰层的压强实现破冰。',
  },
  {
    questionNo: '10',
    kind: 'blank',
    score: 2,
    knowledgePrimary: '电磁感应',
    knowledgeSecondary: ['感应电流'],
    ability: '理解',
    stem: '银行卡磁条快速刷过读卡槽时，相当于磁体穿过闭合金属线圈产生什么。',
  },
  {
    questionNo: '11',
    kind: 'blank',
    score: 4,
    knowledgePrimary: '物体浮沉条件',
    knowledgeSecondary: ['浮力'],
    ability: '分析',
    stem: '茶叶附着气泡排开水体积增大而上浮；吸水后密度与水的密度关系决定下沉。',
  },
  {
    questionNo: '12',
    kind: 'blank',
    score: 2,
    knowledgePrimary: '串并联电路电流关系',
    knowledgeSecondary: ['欧姆定律'],
    ability: '分析',
    stem: '定值电阻与灯泡、滑动变阻器组成电路，两种接法下干路电流之比。',
  },
  {
    questionNo: '13',
    kind: 'drawing',
    score: 2,
    knowledgePrimary: '电路连接',
    knowledgeSecondary: ['实物电路图'],
    ability: '应用',
    stem: '用笔画线完成实物电路连接：两灯串联、电压表测 L2 两端电压。（原图未转录）',
  },
  {
    questionNo: '14',
    kind: 'drawing',
    score: 2,
    knowledgePrimary: '受力分析',
    knowledgeSecondary: ['重力', '带电体吸引轻小物体'],
    ability: '应用',
    stem: '画出上升纸片 A 所受重力 G 与吸引力 F 的示意图。（原图未转录）',
  },
  {
    questionNo: '15',
    kind: 'drawing',
    score: 2,
    knowledgePrimary: '浮力与弹簧测力计',
    knowledgeSecondary: ['阿基米德原理'],
    ability: '分析',
    stem: '两块质量相同、体积不同的金属块从浸没到离开水面，弹簧测力计示数变化图像。（原图未转录）',
  },
  {
    questionNo: '16',
    kind: 'short-answer',
    score: 3,
    knowledgePrimary: '熔点与凝固',
    knowledgeSecondary: ['物态变化'],
    ability: '应用',
    stem: '用「钱范」铸造纯铜钱币：选哪种材料做模具、灌注铜液温度上限及理由。',
  },
  {
    questionNo: '17',
    kind: 'short-answer',
    score: 3,
    knowledgePrimary: '焦耳定律与安全用电',
    knowledgeSecondary: ['安全用电'],
    ability: '应用',
    stem: '发现有人触电应立即采取什么措施；用焦耳定律说明大功率用电器接细电线的隐患。',
  },
  {
    questionNo: '18',
    kind: 'experiment',
    score: 8,
    knowledgePrimary: '伏安法测电阻',
    knowledgeSecondary: ['滑动变阻器', '灯丝电阻与温度'],
    ability: '探究',
    experimentType: '课标必做',
    stem: '测量灯泡电阻：滑片初始位置、电流表接法判断、读数与电阻计算、灯丝电阻变化原因。',
  },
  {
    questionNo: '19',
    kind: 'experiment',
    score: 10,
    knowledgePrimary: '凸透镜成像规律',
    knowledgeSecondary: ['实像与虚像'],
    ability: '探究',
    experimentType: '课标必做',
    stem: '探究凸透镜成像大小变化规律：测量工具、物距与像距/像高的关系、虚像观察、实验条件互斥分析。',
  },
  {
    questionNo: '20',
    kind: 'experiment',
    score: 10,
    knowledgePrimary: '动能与势能',
    knowledgeSecondary: ['斜面实验'],
    ability: '探究',
    experimentType: '拓展探究',
    stem: '组合式滑梯下滑快慢与起点高度的模拟探究：摩擦力方向、运动距离比较、水平缓冲段设计。',
  },
  {
    questionNo: '21',
    kind: 'calculation',
    score: 8,
    knowledgePrimary: '欧姆定律与电功',
    knowledgeSecondary: ['串联电路'],
    ability: '应用',
    stem: '电源 3V、R1=5Ω、电压表示数 2V：求 R2 两端电压、通过 R1 的电流与 10s 内电路做的功。',
  },
  {
    questionNo: '22',
    kind: 'calculation',
    score: 8,
    knowledgePrimary: '能量转化与守恒',
    knowledgeSecondary: ['机械能', '声与电磁波'],
    ability: '分析',
    stem: '返回舱返回三阶段：减速核心任务、测距信号的选择与位置判断、舱内控温设计、内能增加量与重力势能减少量的比较。',
  },
]

/** 8 道选择题入库（题干 + 选项 + 官方答案 + 解析）；图题与主观题不进题库。 */
const bankItems = [
  {
    id: 'gz-zk-2024-q1',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '识记',
    knowledge: ['温度与内能', '温度'],
    stem: '端午节吃粽子是一项传统习俗。刚出锅的粽子很烫，「烫」是形容粽子的（ ）',
    options: ['A．质量大', 'B．温度高', 'C．体积大', 'D．密度大'],
    answer: 'B',
    analysis: '「烫」描述的是物体的冷热程度，即温度高；质量、体积、密度与冷热无关。',
  },
  {
    id: 'gz-zk-2024-q2',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '识记',
    knowledge: ['核能', '能源分类'],
    stem: '「华龙一号」核电机组是中国核电技术走向世界的「国家名片」。它发电时利用了核裂变释放的下列哪种能量（ ）',
    options: ['A．核能', 'B．动能', 'C．光能', 'D．势能'],
    answer: 'A',
    analysis: '核裂变释放的是核能，发电过程再把核能转化为内能、机械能，最终转化为电能。',
  },
  {
    id: 'gz-zk-2024-q3',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['声音的特性', '音色'],
    stem: '鸟鸣清脆如玉，琴声婉转悠扬。人耳能辨别鸟声与琴声，主要是根据声音的（ ）',
    options: ['A．传播速度', 'B．音调', 'C．响度', 'D．音色'],
    answer: 'D',
    analysis: '音色由发声体的材料和结构决定，是辨别不同发声体的依据；鸟声与琴声的差别正在音色。',
  },
  {
    id: 'gz-zk-2024-q4',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['内能的利用', '热机'],
    stem: '内能的利用推动了工业和社会的快速发展。下列机器设备利用内能工作的是（ ）',
    options: ['A．电动机', 'B．计算机', 'C．汽油机', 'D．照相机'],
    answer: 'C',
    analysis: '汽油机把燃料燃烧释放的内能转化为机械能；电动机、计算机利用电能，照相机利用光能。',
  },
  {
    id: 'gz-zk-2024-q5',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['运动状态', '惯性'],
    stem: '「贵州村超」足球赛精彩纷呈。比赛中，足球在空中划过一道弧线飞向球门。此过程中对足球分析正确的是（ ）',
    options: ['A．相对球门静止', 'B．运动状态改变', 'C．惯性逐渐消失', 'D．受平衡力作用'],
    answer: 'B',
    analysis:
      '足球的速度大小和方向都在变化，运动状态改变；它只受重力（和空气阻力），不是平衡力；惯性是物体的固有属性，不会消失。',
  },
  {
    id: 'gz-zk-2024-q6',
    kind: 'choice-single',
    score: 3,
    difficulty: 'basic',
    ability: '理解',
    knowledge: ['光的反射', '平面镜成像'],
    stem: '《淮南万毕术》中记载：「取大镜高悬，置水盆于其下，则见四邻。」人能通过盆中水面及平面镜观察墙外情况均利用了（ ）',
    options: ['A．光的折射', 'B．光的色散', 'C．光的反射', 'D．光的直线传播'],
    answer: 'C',
    analysis: '水面与平面镜成像都是光的反射：光在两种介质分界面上改变传播方向返回原介质。',
  },
  {
    id: 'gz-zk-2024-q7',
    kind: 'choice-multi',
    score: 3,
    difficulty: 'medium',
    ability: '分析',
    knowledge: ['动态电路', '欧姆定律', '电功率'],
    stem: '（多选）如图甲所示电路，电源电压恒为 9V，灯泡 L 额定电压为 6V。下列分析正确的是（ ）',
    options: [
      'A．无论如何移动滑片，L 的电阻始终为 20Ω',
      'B．滑片向左移动过程中，L 的实际功率减小',
      'C．为保证电路安全，R 接入的最小阻值为 10Ω',
      'D．L 实际功率为 0.75W 时，R 的阻值为 24Ω',
    ],
    answer: 'BCD',
    analysis:
      '灯丝电阻随温度变化，不是定值（A 错）；滑片移动改变变阻器接入阻值，进而改变灯的电压与实际功率（B 对）；为不超额定电压需限制最小接入阻值（C 对）；由实际功率求灯两端电压与电流，再算变阻器阻值（D 对）。原题附电路图。',
  },
  {
    id: 'gz-zk-2024-q8',
    kind: 'choice-multi',
    score: 3,
    difficulty: 'medium',
    ability: '分析',
    knowledge: ['杠杆平衡', '杠杆'],
    stem: '（多选）如图甲所示的条凳，人若坐在凳的一端，极易使其另一端上翘而摔倒。现将其简化为如图乙所示的示意图，下列分析正确的是（ ）',
    options: [
      'A．压力作用于 A 点，可将条凳视为绕 E 点转动的杠杆',
      'B．只要压力作用于凳面的中间，则条凳一定不会上翘',
      'C．只要在 A、D 点同时施加压力，则条凳一定不会上翘',
      'D．在 B 或 C 点施加一个压力，则条凳一定不会上翘',
    ],
    answer: 'ABD',
    analysis:
      '把条凳看成绕支点 E 转动的杠杆，分析压力作用点与力臂：压力作用在支点一侧使另一侧上翘，作用位置跨过支点两侧或位于支点附近时不再上翘。原题附示意图。',
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
      reviewer: 'ingest-gz-2024',
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
        gradingPoints: [{ text: `官方答案 ${item.answer}`, score: item.score }],
      },
      answerTier: 'manual-transcript',
      sourceLabel: '2024 年贵州省中考理综（物理部分）',
      sourceQuestionNo: item.id.replace('gz-zk-2024-q', ''),
      sourceUrl: SOURCE_URLS.split(' ')[1],
      anomalies: ['图题为原卷附图，未转录进题干'],
      reuseModes: ['verbatim', 'adapt'],
      enteredBy: 'ingest-gz-2024',
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
