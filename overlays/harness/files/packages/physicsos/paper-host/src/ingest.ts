/**
 * Bank ingest — pasted public question text becomes structured {@link BankItem}
 * drafts. The model extracts stems/options/answers and tags the curriculum
 * fields; every item enters `pending` and only teacher verification moves it
 * into the assembly candidate pool. The prompt also carries the deployment's
 * level/subject context so score and difficulty labels land in local
 * vocabulary, and asks the model to flag dirty web data (printed answer keys
 * that contradict their own解析) into `anomalies` rather than silently
 * trusting it.
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { BankItem, PaperLevel, Subject } from '@physicsos/question-paper'
import { callModel, extractJson, sanitizeQuestion, type PaperModelRoute } from './draft.ts'

/* The model emits ingest drafts without storage-owned fields: id/stemHash/
   status/enteredBy/enteredAt/reuseModes are stamped by the service. */
const ingestItemSchema = z.object({
  stem: z.string().min(1),
  options: z.array(z.string()).optional(),
  kind: z.enum([
    'choice-single', 'choice-multi', 'blank', 'drawing', 'short-answer', 'experiment', 'calculation',
  ]),
  answer: z.object({
    result: z.string().min(1),
    steps: z.array(z.string()),
    gradingPoints: z.array(z.object({ text: z.string(), score: z.number() })),
    equivalents: z.array(z.string()).optional(),
  }),
  knowledge: z.array(z.string()).min(1),
  ability: z.enum(['识记', '理解', '应用', '分析', '探究']),
  difficulty: z.enum(['basic', 'medium', 'hard']),
  score: z.number().positive(),
  sourceLabel: z.string().optional(),
  sourceQuestionNo: z.string().optional(),
  subQuestions: z.array(z.object({
    no: z.string(), text: z.string(), score: z.number(),
  })).optional(),
  anomalies: z.array(z.string()).default([]),
})
const ingestResponseSchema = z.array(ingestItemSchema)

/** What the model emits per item — storage fields get stamped downstream. */
export type IngestedItem = z.infer<typeof ingestItemSchema>

/** Ingest request context the service passes through to the prompt. */
export interface IngestInput {
  /** Pasted question text; may hold many questions in any web layout. */
  readonly text: string
  readonly level: PaperLevel
  readonly subject: Subject
  readonly sourceUrl?: string
  readonly sourcePaperId?: string
  readonly enteredBy: string
}

const SYSTEM = `你是中学物理/化学题库结构化专家。把粘贴的题目文本抽取为严格 JSON 数组，不要输出其他文字。

每道题一个对象：
- stem: 题干正文（公式一律 LaTeX 行内 $...$；实验数据表用 Markdown 表格，禁止 array/tabular）
- options: ["A. ...","B. ...",...]（仅选择题）
- kind: choice-single|choice-multi|blank|experiment|calculation|short-answer|drawing
- answer: {result, steps:[解析步骤], gradingPoints:[{text,score}]}，gradingPoints 分值合计等于 score
- knowledge: [主考点,...次考点]（规范考点词，如 共点力平衡/理想变压器/伏安法测电阻）
- ability: 识记|理解|应用|分析|探究
- difficulty: basic|medium|hard
- score: 按题目在原卷的分值推断；无标注时按学段题型惯例（中考单选 3 分，高考单选 4 分、多选 6 分）
- sourceLabel: 括号内来源标注（如 2024·贵阳一中高三月考）；无则省略
- sourceQuestionNo: 题号字符串
- subQuestions: 主观题小问 [{no,text,score}]，无则省略
- anomalies: 数据可疑时列出（【答案】与【解析】矛盾、印刷错误、条件不足——以解析推演的物理结果为准并用于 result）

纪律：
- 逐字转录题干，不改写、不补条件；文本里看不清的图表只写"如图所示"，不编造 figure。
- 【答案】与【解析】矛盾时，result 取解析推演的正确结果，矛盾写入 anomalies。
- 多选题 result 是选项字母组合（如 "BC"）；单选是单个字母。
- 无法判定的字段不要猜：没有来源就不写 sourceLabel，没有小问就不写 subQuestions。`

/**
 * Structure one pasted text block into ingest drafts.
 * @param ctx - plugin context carrying `llm`.
 * @param route - model route.
 * @param input - the pasted text plus its level/subject context.
 * @returns validated drafts in source order.
 */
export async function ingestBankText(
  ctx: Context,
  route: PaperModelRoute,
  input: IngestInput,
): Promise<IngestedItem[]> {
  const prompt = [
    `学段：${input.level === 'zhongkao' ? '初中（中考）' : '高中（高考选择性考试）'}　学科：${input.subject}`,
    '',
    '待结构化的题目文本：',
    input.text,
  ].join('\n')
  const text = await callModel(ctx, route, SYSTEM, prompt)
  const raw = extractJson(text)
  const parsed = ingestResponseSchema.safeParse(
    Array.isArray(raw) ? raw.map(sanitizeQuestion) : raw)
  if (!parsed.success) {
    throw new Error(`bank ingest failed schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  return parsed.data
}

/** Service-facing signature kept in the host so ingest stays a one-call op. */
export type IngestBank = (input: IngestInput) => Promise<{ created: BankItem[]; duplicates: string[] }>
