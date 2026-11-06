/**
 * AI drafting — the model writes questions against the confirmed 双向细目表,
 * one blueprint section per call so a truncated or malformed response costs
 * one section, never the whole paper. Each response must be a JSON array
 * matching the question schema; parse or schema failures retry with the
 * rejection fed back, capped by the plan's two-repair budget.
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  BankItem, PaperDocument, PaperJob, PaperQuestion, SpecRow,
} from '@physicsos/question-paper'
import { paperQuestionSchema } from './domain.ts'
import { blueprintById, mixCoefficient } from '@physicsos/question-paper'
import { z } from 'zod'

/** Model route the deployment configures for drafting and solving. */
export interface PaperModelRoute {
  readonly provider: string
  readonly model: string
}

/* Review status is system-owned: the model's prose never decides it, so the
   draft schema strips `status` and every drafted question enters as 'draft'. */
const draftSectionSchema = z.array(paperQuestionSchema.omit({ status: true }))

/** Models emit `null` for omitted fields; treat null as absent, and `knowledge`
 * — the one required array — falls back to empty for the checker to flag.
 * @param raw - one parsed question object from the model's JSON.
 * @returns a schema-clean copy; non-objects pass through for the schema to reject.
 */
export function sanitizeQuestion(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  /* Copy without the nulls in one pass — a `delete` on a computed key would
     mutate the caller's object shape and defeats the compiler's tracking. */
  const q: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== null) q[key] = value
  }
  q['knowledge'] ??= []
  /* Models reach for `type` as the question-kind key when the prompt does
     not pin `kind` verbatim — normalize instead of failing the schema. */
  if (q['kind'] === undefined && typeof q['type'] === 'string') {
    q['kind'] = q['type']
    delete q['type']
  }
  /* Loose models emit numeric text fields (`result: 4`, `steps: [...]`
     with numbers). Coerce where the schema demands a string — `String(4)`
     is always what a printed paper means. */
  const str = (v: unknown): unknown => (typeof v === 'number' ? String(v) : v)
  q['stem'] = str(q['stem'])
  if (Array.isArray(q['options'])) q['options'] = q['options'].map(str)
  if (Array.isArray(q['knowledge'])) q['knowledge'] = q['knowledge'].map(str)
  if (Array.isArray(q['subQuestions'])) {
    q['subQuestions'] = (q['subQuestions'] as Record<string, unknown>[]).map(s => ({
      ...s, no: str(s['no']), text: str(s['text']),
    }))
  }
  const answer = q['answer']
  if (typeof answer === 'object' && answer !== null) {
    const a = { ...(answer as Record<string, unknown>) }
    a['result'] = str(a['result'])
    if (Array.isArray(a['steps'])) a['steps'] = a['steps'].map(str)
    if (Array.isArray(a['gradingPoints'])) {
      a['gradingPoints'] = (a['gradingPoints'] as Record<string, unknown>[]).map(g => ({ ...g, text: str(g['text']) }))
    }
    q['answer'] = a
  }
  const figure = q['figure']
  if (typeof figure === 'object' && figure !== null) {
    const f = { ...(figure as Record<string, unknown>) }
    if (f['kind'] !== 'line-diagram' && f['kind'] !== 'image') f['kind'] = 'line-diagram'
    /* The ref becomes the file name `fig-<ref>.png`, so it is normalised here
       rather than trusted: the model is told to use lowercase letters, digits
       and hyphens, but a stray separator or space would otherwise decide where
       the drawing lands. An unusable ref falls back to the question number. */
    const refValue = str(f['ref'])
    const rawRef = (typeof refValue === 'string' ? refValue : '')
      .trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    const number = q['number']
    f['ref'] = rawRef === '' ? `q${typeof number === 'number' || typeof number === 'string' ? String(number) : 'x'}` : rawRef
    f['caption'] = str(f['caption'])
    q['figure'] = f
  }
  return q
}

/**
 * Assemble one streamed call into its text. Shared by drafting, repair,
 * bank ingest and adaptation — every model call in this plugin takes this
 * shape: one system prompt, one user message, text blocks joined.
 * @param ctx - plugin context carrying `llm`.
 * @param route - the deployment's provider/model pair.
 * @param system - the system prompt for this call.
 * @param prompt - the single user message.
 * @returns the joined text of all text blocks; throws on error/aborted finishes.
 */
/* The upstream occasionally completes a request with `stop` and no content at
   all — measured on the deployment's own provider at roughly one response in
   three for a full system prompt. The framework's retry policy does cover
   EMPTY_RESPONSE, but it retries the adapter call; the same prompt failing
   repeatedly inside one section still loses the whole draft. Retrying here
   keeps the attempt budget visible to the caller's error message and lets a
   transient empty completion cost a few seconds instead of a failed section. */
const EMPTY_RESPONSE_ATTEMPTS = 3
const EMPTY_RESPONSE_BACKOFF_MS = 1_500

const isRetryableEmpty = (_message: string, code: string): boolean => code === 'EMPTY_RESPONSE'

export async function callModel(ctx: Context, route: PaperModelRoute, system: string, prompt: string): Promise<string> {
  let lastFailure = ''
  for (let attempt = 1; attempt <= EMPTY_RESPONSE_ATTEMPTS; attempt += 1) {
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
      /* 32768, not 16000: reasoning models (deepseek-v4.1-flash) bill their
         thinking against the same completion budget — a full 高考 非选择题
         section spent all 16000 tokens on reasoning_content and returned zero
         text characters ("no JSON in model output (0 chars)"), failing the
         draft after both repair rounds. 32768 is the adapter's own shipped cap
         for this model family and leaves the JSON several times the headroom
         of the biggest section observed. */
      maxTokens: 32768,
      temperature: 0.4,
    })) {
      assembler.push(chunk)
    }
    /* Adapter failures arrive as a terminal finish chunk, not a throw —
       surface them instead of parsing an empty text as "no JSON". */
    const finish = assembler.finish
    if (finish.kind === 'aborted') throw new Error('model call aborted')
    if (finish.kind === 'error') {
      const detail = `model call failed: ${finish.failure.message} (${finish.failure.code}); `
        + `prompt ${String(prompt.length)} chars, system ${String(system.length)} chars`
      if (!isRetryableEmpty(finish.failure.message, finish.failure.code) || attempt === EMPTY_RESPONSE_ATTEMPTS) {
        throw new Error(attempt > 1 ? `${detail}; after ${String(attempt)} attempts` : detail)
      }
      lastFailure = detail
      await new Promise(resolve => setTimeout(resolve, EMPTY_RESPONSE_BACKOFF_MS * attempt))
      continue
    }
    return assembler.blocks()
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
  }
  throw new Error(lastFailure)
}

/**
 * Extract the first JSON array or object from model output.
 * @param text - the raw model text (may wrap JSON in a fenced block).
 * @returns the parsed value; throws when no `[`/`{` appears.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced?.[1] ?? text
  const start = candidate.search(/[[{]/)
  if (start === -1)
    throw new Error(`no JSON in model output (${text.length} chars): ${text.slice(0, 160)}`)
  return JSON.parse(candidate.slice(start).replace(/```\s*$/, '').trimEnd())
}

const SYSTEM = `你是贵州省初高中学业水平考试的资深命题教师，熟悉人教版教材与贵州本土考情。按给定的双向细目表逐题命制试题，输出严格 JSON 数组，不要输出其他文字。

每道题的字段：
- number: 题号（与细目表一致）
- subject: "physics" | "chemistry"
- kind: 题型
- score: 分值
- stem: 题干（公式一律 LaTeX，行内 $...$，独立成行 $$...$$，分式用 \\dfrac）
- options: 选择题必填，["A. ...", "B. ...", ...]
- subQuestions: 非选择题可带小问 [{no, text, score}]
- figure: 需要配图时 {kind:"line-diagram", ref, caption}；不需要则省略（规则见下方「配图」一节）
- answer: {result, steps:[推导步骤], gradingPoints:[{text,score}], equivalents?}，gradingPoints 分值合计必须等于 score
- knowledge: 考点标签数组（与细目表一致）
- ability: 识记|理解|应用|分析|探究
- difficulty: basic|medium|hard（与细目表一致）

命题纪律（逐条遵守）：
- 贴合细目表：每题的 kind/score/knowledge/ability/difficulty 必须与细目表完全一致，knowledge 数组必须覆盖细目表该题全部考点，不得自行增减或替换考点。
- 可计算题必须机器可复核：experiment / calculation（含含计算的填空）题，题干必须包含一行「已知：」，把求解所需的全部已知量写成「符号 = 数值 单位」的逗号列表（如「已知：m = 2 kg，g = 10 m/s²，v = 3 m/s」），纯数数值、不带文字修饰；常数（g、c 等）也必须显式给出。平台的物理引擎会仅凭题干文本独立重解每道可计算题，已知量缺失或埋在叙述里都会被判为无法复核并阻断整卷。
- 题型用词必须落在引擎能识别的范围内：引擎按题干中的关键词选择求解模型，用口语化情境（如「踢球做功」「电梯上升」）会让它读不出题型。可计算题请从下列模型里选一个来表述，并**在题干中保留该模型的关键词**：
  · 斜面 / 摩擦：写成「倾角 θ 的斜面」「动摩擦因数 μ」；
  · 抛体：写「平抛」「斜抛」「抛出」；
  · 牛顿运动定律：写「合力」「加速度为 a」「牛顿第二定律」；
  · 匀速直线：写「匀速直线运动」；匀变速：写「匀加速」「匀变速」「加速度」；
  · 圆周运动：写「匀速圆周运动」「向心力」「半径为 r」；
  · 万有引力：写「卫星」「轨道半径」「周期」；
  · 功能关系：写「动能定理」「机械能守恒」「重力势能」时，题干须给出初末状态的速度与高度，不得只给「做功多少」；
  · 动量：写「动量守恒」「碰撞」，并给出碰前碰后速度与质量；
  · 电场 / 电路：写「匀强电场」「电动势」「内阻」「串联」「并联」；
  · 磁场：写「匀强磁场」「洛伦兹力」「垂直纸面向里 / 外」并给出 B、q、m、v；
  · 电磁感应：写「磁感应强度变化」「切割磁感线」「感应电动势」；
  · 光学：写「折射」「入射角」「折射率」「凸透镜」「焦距」；
  · 振动与波：写「简谐运动」「波长」「频率」「波速」。
  若某道题的物理情境确实无法用上述模型表达（如需要学生做非标准建模），就把它写成计算题且**不要在答案里给出唯一数值**，改问定性结论；带虚构数值的开放式情境会被引擎判为无法复核。
- 每个已知量都要能被引擎单独取用：符号用拉丁或希腊字母，不要写成「小球的质量」「木块速度」这样的中文描述；同一个量在全卷用同一个符号。
- 选择题：干扰项必须是学生真实易错的概念混淆或计算偏差，不得凑数；各选项量纲与单位一致；不得使用"以上都对/以上都不对"式兜底项；单选答案唯一，多选至少两项正确。
- 选择题答案格式：answer.result 只写选项字母本身（如 "C" 或 "AD"），禁止附带数值、单位或任何括号说明——数值与理由写进 steps。
- 计算题：给定数据必须真实可算、量级合理；basic 题不超过两步运算；结果保留位数符合中学惯例（一般两位有效数字或整数）。
- 实验题：必须是课标要求的实验，写明操作、现象、结论或数据处理要求；不得杜撰实验名称。
- 主观题小问由易到难递进，后问可引用前问结果。
- 答案：result 是最终结论；steps 按评卷惯例组织——公式 → 代入数据 → 运算结果 → 单位，最后写"答：…"；计算/综合题只写最后结果不得分，步骤缺失即扣分；gradingPoints 分值合计必须等于 score；equivalents 列出可接受的等价表述。
- 数据表：题干中的实验/测量数据表一律用 Markdown 表格（| 列 | 列 | 加分隔行）书写，禁止 LaTeX array/tabular 环境——导出端无法将其渲染为表格。
- 禁止：超出已教范围、条件不足或无解、表述歧义、编造数据。

配图（figure 字段）——按下列判据逐题判断，不要一律省略：

必须配图的题型（题干离开图就无法作答，或图承载了题干未写全的几何关系）：
1. 受力分析：多个力作用在一处（斜面、悬挂、叠放、连接体、支架），题目问"受力个数/方向/大小"或需要正交分解。
2. 电路：任何含多个元件、开关、滑动变阻器、电流表电压表的电路题；测电阻、测功率、探究欧姆定律的实验电路。
3. 光路：反射、折射、透镜成像、平面镜成像、全反射；需要作图或读图判断的题。
4. 运动轨迹与情境：平抛/斜抛轨迹、传送带、圆周运动（含竖直面最高最低点）、板块模型、追及相遇的 v-t / x-t 图像题。
5. 测量与实验装置：刻度尺读数、天平、弹簧测力计、温度计、电表读数、打点计时器纸带、凸透镜实验光具座。
6. 几何关系复杂：木块在斜面上、绳与杆的夹角、磁场中带电粒子的圆周轨迹（需标明速度方向与磁场方向）。
7. 需要"如图"才能描述位置的题：题目本身就要学生指认图中某个点、某段导线、某个方向。

不需要配图的题型（强行配图反而增加错误风险）：
- 纯文字叙述、无空间关系的概念辨析题（如"下列说法正确的是"，选项与图形无关）。
- 只给数量关系的计算题（如"已知 m=2kg，v=3m/s，求动能"），所有量已在题干写全。
- 纯代数推导、单位换算、公式变形。
- 题干已经完整描述了全部几何关系，且学生不需要看图即可作答。

判断依据（按顺序自问）：
- 题干里是否需要出现"如图所示""图中""在图中"这类指示语？如果需要 → 必须有图。
- 学生不看图能否唯一确定各物体的相对位置、各力的作用线、各元件连接方式？不能 → 必须有图。
- 图只是把题干文字又画了一遍、没有新增几何信息 → 不要配图。

正例（必须带 figure）：
- "如图，质量 m 的物块静止在倾角 θ 的斜面上，求斜面对物块的支持力大小。" → 受力分析，必须配图。
- "在如图所示的电路中，电源电动势 E、内阻 r，R₁ 与 R₂ 串联……" → 电路，必须配图。
- "一束光从空气射入玻璃砖，如图所示，入射角 θ₁……" → 光路，必须配图。
- "小球以初速度 v₀ 水平抛出，轨迹如图……" → 运动轨迹，必须配图。

反例（不得带 figure）：
- "关于牛顿第一定律，下列说法正确的是（  ）A. … B. …" → 纯概念辨析，无空间关系。
- "质量为 2 kg 的物体以 3 m/s 的速度运动，求其动能。" → 量已写全，不需要图。
- "把 5 kg 的物体从 2 m 高处自由释放，求落地速度（g 取 10 m/s²）。" → 自由落体，无几何关系，不需要图。

figure 字段的写法：
- ref: 全卷唯一的短标识，只用小写字母、数字和连字符（如 "q1-incline"、"q7-circuit"、"q12-ray"），不得重复，不得含空格或中文。
- kind: 一律写 "line-diagram"（本平台用黑白线稿，不用写实照片）。
- caption: **这是直接交给绘图模型的作图指令，不是给学生看的图题名**。必须写成一句完整的、看得见几何关系的作图描述——列出要画的全部物体、相对位置、角度或长度标记、力的方向与作用点、元件连接方式、光线的出入射方向。只写"如图"或"受力示意图"会生成错误或缺元素的图。

caption 的正反例：
- 差："物块在斜面上的受力示意图"（模型不知道斜角、不知道有哪些力、不知道方向）。
- 好："一个矩形木块静止在倾角 30° 的斜面上，斜面固定在地面，木块中心画出竖直向下的重力箭头 G、垂直于斜面表面斜向上的支持力箭头 N，并用虚线标出 30° 角。"
- 差："电路图"。
- 好："电路图：电源（电动势 E、内阻 r）在左侧，开关 S 与定值电阻 R₁、R₂ 串联成回路，R₁ 两端并联一个电压表，导线连接完整，各元件标出符号。"
- 差："光路图"。
- 好："一束平行光从空气斜射入一块矩形玻璃砖上表面，画出法线（虚线）、入射光线、折射光线和出射光线，标出入射角 θ₁ 与折射角 θ₂，光线用箭头表示传播方向。"

caption 与题干必须一致：caption 里出现的角度、名称、方向、元件编号，必须与 stem 完全对应，不得出现题干没有的量。

情境：可适度引用贵州本土素材（高铁、大数据、村超、天眼等）但不得编造数据。`

/**
 * Draft one section's questions against its spec rows.
 * @param ctx - plugin context carrying `llm`.
 * @param route - model route.
 * @param job - the job being drafted (for scope context).
 * @param sectionTitle - printed section heading.
 * @param rows - the section's spec rows.
 * @param priorError - repair-round feedback, when retrying.
 * @param exemplars - verified bank items nearest this section's rows,
 *   shown as style/difficulty references the model must not copy.
 * @returns validated questions in spec order.
 */
export async function draftSection(
  ctx: Context,
  route: PaperModelRoute,
  job: PaperJob,
  sectionTitle: string,
  rows: readonly SpecRow[],
  priorError?: string,
  exemplars: readonly BankItem[] = [],
): Promise<PaperQuestion[]> {
  const request = job.request
  /* The blueprint's own grading rules for this section (multi-choice partial
     credit, "answer-only scores zero") ride along so the drafted questions
     and their gradingPoints follow the real marking convention. */
  const sectionNote = blueprintById(job.blueprintId)
    ?.sections.find(section => section.title === sectionTitle)?.note
  const prompt = [
    `学段：${request.level === 'zhongkao' ? '初中（中考）' : '高中（高考选择性考试）'}`,
    `学科：${request.subjects.join('+')}　卷型：${request.kind}　教材：${request.textbook}`,
    `考试目标年份：${request.targetYear}`,
    request.chapters.length > 0 ? `已教范围：${request.chapters.join('；')}` : '',
    request.exclude.length > 0 ? `排除内容：${request.exclude.join('；')}` : '',
    /* The coefficient the teacher targeted, restated in model terms: actual
       solve-step counts and trap density inside each difficulty tier should
       lean toward this P-value, or the check stage reports the drift. */
    `全卷目标难度系数：${mixCoefficient(request.difficulty).toFixed(2)}（预期得分率，越高越容易）。在遵守各行难度档位的前提下，控制实际解题步数、数据复杂度与陷阱密度，使整卷实际难度向该系数靠拢。`,
    '',
    `本次命制板块：${sectionTitle}`,
    sectionNote !== undefined ? `板块给分规则：${sectionNote}` : '',
    '双向细目表：',
    ...rows.map(row =>
      `  第${row.questionNo}题 ${row.kind} ${row.score}分 考点[${row.knowledge.join('、') || '自定'}] 能力${row.ability} 难度${row.difficulty}`),
    exemplars.length === 0 ? '' : [
      '',
      '题库参考（风格与难度参照，禁止照抄题目内容、情境与数据）：',
      ...exemplars.map(item =>
        `  [${item.sourceLabel ?? '题库'}] ${item.kind} ${item.score}分 难度${item.difficulty}\n    ${item.stem.slice(0, 240)}`),
    ].join('\n'),
    priorError === undefined ? '' : `\n上次输出不合格：${priorError}。请修正后重新输出完整 JSON。`,
  ].filter(line => line !== '').join('\n')

  const text = await callModel(ctx, route, SYSTEM, prompt)
  let raw = extractJson(text)
  /* Loose wrappers: a double-encoded JSON string parses to string, and
     `{questions: [...]}` parses to an object — unwrap both before the
     schema sees them. */
  if (typeof raw === 'string') raw = JSON.parse(raw)
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const inner = Object.values(raw).find(Array.isArray)
    if (inner !== undefined) raw = inner
  }
  const parsed = draftSectionSchema.safeParse(
    Array.isArray(raw) ? raw.map(sanitizeQuestion) : raw)
  if (!parsed.success) {
    throw new Error(`section '${sectionTitle}' draft failed schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  /* Generated questions are stamped 'generated' — this also scrubs any
     provenance the model fabricated, since bank lineage must come from the
     assembler, never from model output. */
  return parsed.data.map(q => ({ ...q, provenance: { mode: 'generated' as const }, status: 'draft' as const }))
}

const REPAIR_SYSTEM = `你是贵州省初高中学业水平考试的资深命题教师，按教师的修改建议修订已有试题。
只输出该题的完整 JSON 对象（字段与起草约定相同），不要输出其他文字。

纪律：
- 题号、题型、分值不得改动；考点、能力、难度必须与细目表一致。
- 只修改建议涉及的部分，其余保持原题不变。
- 公式一律 LaTeX（行内 $...$）；改动后题目必须仍然可解、答案与评分点同步更新。`

/**
 * Revise one drafted question against the teacher's suggestion. Spec-bound
 * fields (number/kind/score/difficulty/ability) are force-aligned to the
 * confirmed spec row so a repair can never drift the question off the
 * 双向细目表; knowledge keeps the spec coverage plus any model additions.
 * @param ctx - plugin context carrying `llm`.
 * @param route - model route.
 * @param job - the job (spec table + request scope).
 * @param question - the question being revised.
 * @param suggestion - the teacher's revision request.
 * @returns the revised question with status 'draft'.
 */
export async function repairQuestion(
  ctx: Context,
  route: PaperModelRoute,
  job: PaperJob,
  question: PaperQuestion,
  suggestion: string,
): Promise<PaperQuestion> {
  const spec = job.specTable.find(row => row.questionNo === question.number)
  const prompt = [
    `学段：${job.request.level === 'zhongkao' ? '初中（中考）' : '高中（高考选择性考试）'}　教材：${job.request.textbook}`,
    spec === undefined ? '' : `细目表约束：第${spec.questionNo}题 ${spec.kind} ${spec.score}分 考点[${spec.knowledge.join('、')}] 能力${spec.ability} 难度${spec.difficulty}`,
    '',
    '原题 JSON：',
    JSON.stringify(question),
    '',
    `教师修改建议：${suggestion}`,
  ].filter(line => line !== '').join('\n')

  const text = await callModel(ctx, route, REPAIR_SYSTEM, prompt)
  const parsed = paperQuestionSchema.omit({ status: true }).safeParse(sanitizeQuestion(extractJson(text)))
  if (!parsed.success) {
    throw new Error(`repair of question ${question.number} failed schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  return {
    ...parsed.data,
    number: question.number,
    ...(spec === undefined ? {} : {
      kind: spec.kind, score: spec.score, difficulty: spec.difficulty, ability: spec.ability,
      knowledge: [...new Set([...spec.knowledge, ...parsed.data.knowledge])],
    }),
    provenance: question.provenance ?? { mode: 'generated' },
    status: 'draft',
  }
}

const ADAPT_SYSTEM = `你是贵州省初高中学业水平考试的资深命题教师，负责把题库中的已有试题改编为新题。
只输出该题的完整 JSON 对象，不要输出其他文字。

必填字段：number(题号)、subject("physics"|"chemistry")、kind(题型)、score(分值)、stem(题干)、
knowledge(考点数组)、ability(识记|理解|应用|分析|探究)、difficulty(basic|medium|hard)、
answer{result,steps,gradingPoints[{text,score}]}；选择题另需 options 数组；配图需 figure。

改编纪律（逐条遵守）：
- 保骨架：物理模型、情境结构、数据关系、设问层次与原题一致——学生用到的分析路径不变。
- 换表面：更换情境载体（如斜面换传送带、小球换滑块）、全部给定数值、选项表述与答案。
- 数值必须真实可算、量级合理，重新计算答案与评分点；不得保留原题数值只改说法。
- 题号、题型、分值按细目表；考点、能力、难度必须与细目表一致。
- 原题有配图说明的，改编后需要配图则输出 figure 字段并同步 caption。`

/**
 * Adapt one verified bank item into a new question for the spec row: the
 * model keeps the skeleton and rewrites surface + values, then spec-bound
 * fields are force-aligned like a repair. The result carries 'adapted'
 * provenance and re-enters checking and independent solving as a new
 * question — an adaptation inherits nothing about correctness.
 * @param ctx - plugin context carrying `llm`.
 * @param route - model route.
 * @param job - the job (spec table + request scope).
 * @param item - the verified bank item serving as skeleton.
 * @param row - the spec row it must satisfy.
 * @returns the adapted question with status 'draft'.
 */
export async function adaptBankItem(
  ctx: Context,
  route: PaperModelRoute,
  job: PaperJob,
  item: BankItem,
  row: SpecRow,
): Promise<PaperQuestion> {
  const prompt = [
    `学段：${job.request.level === 'zhongkao' ? '初中（中考）' : '高中（高考选择性考试）'}　教材：${job.request.textbook}`,
    `细目表约束：第${row.questionNo}题 ${row.kind} ${row.score}分 考点[${row.knowledge.join('、')}] 能力${row.ability} 难度${row.difficulty}`,
    job.request.chapters.length > 0 ? `已教范围：${job.request.chapters.join('；')}` : '',
    job.request.exclude.length > 0 ? `排除内容：${job.request.exclude.join('；')}` : '',
    '',
    `原题（${item.sourceLabel ?? '题库'}，题号${item.sourceQuestionNo ?? '-'}）JSON：`,
    JSON.stringify({
      stem: item.stem, options: item.options, subQuestions: item.subQuestions,
      figure: item.figure, answer: item.answer,
    }),
  ].filter(line => line !== '').join('\n')

  /* One retry with the schema error fed back — the same structural-repair
     round drafting gets, since a malformed first attempt says nothing
     about whether the item can adapt. */
  let lastIssue = ''
  let data: Omit<z.infer<typeof paperQuestionSchema>, 'status'> | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callModel(ctx, route, ADAPT_SYSTEM,
      lastIssue === '' ? prompt : `${prompt}\n\n上次输出不合格：${lastIssue}。请修正后重新输出完整 JSON。`)
    const parsed = paperQuestionSchema.omit({ status: true }).safeParse(sanitizeQuestion(extractJson(text)))
    if (parsed.success) { data = parsed.data; break }
    lastIssue = parsed.error.issues[0]?.message ?? 'unknown'
  }
  if (data === undefined) {
    throw new Error(`adaptation of bank item ${item.id} failed schema: ${lastIssue}`)
  }
  return {
    ...data,
    number: row.questionNo,
    kind: row.kind, score: row.score, difficulty: row.difficulty, ability: row.ability,
    knowledge: [...new Set([...row.knowledge, ...data.knowledge])],
    provenance: {
      bankItemId: item.id,
      mode: 'adapted',
      ...(item.sourceLabel !== undefined ? { sourceLabel: item.sourceLabel } : {}),
    },
    status: 'draft',
  }
}

/**
 * Assemble a full document from per-section drafts.
 * @param job - the job.
 * @param sectionTitles - blueprint section order.
 * @param drafted - questions grouped by section title.
 * @returns the PaperDocument to commit.
 */
export function assembleDocument(
  job: PaperJob,
  sectionTitles: readonly string[],
  drafted: ReadonlyMap<string, readonly PaperQuestion[]>,
): PaperDocument {
  const request = job.request
  return {
    id: job.id,
    title: `${request.targetYear} ${request.level === 'zhongkao' ? '贵州省中考' : '贵州省高考'}物理${{
      unit: '单元测试卷', weekly: '周考卷', monthly: '月考卷',
      midterm: '期中卷', final: '期末卷', mock: '模拟预测卷',
    }[request.kind]}`,
    level: request.level,
    kind: request.kind,
    header: {
      examName: request.level === 'zhongkao' ? '贵州省初中学业水平考试' : '贵州省选择性考试',
      grade: request.level === 'zhongkao' ? '九年级' : '高三',
      subjectLine: request.subjects.map(s => s === 'physics' ? '物理' : '化学').join('、'),
      totalScore: request.totalScore,
      minutes: request.minutes,
      candidateFields: ['姓名', '班级', '考号'],
    },
    sections: sectionTitles.map(title => ({
      title,
      items: drafted.get(title) ?? [],
    })),
    specTable: job.specTable,
    policyLabel: '依据已核实政策编制的训练卷',
  }
}
