/**
 * 题图转录 — a pasted photo or scanned page becomes ingestable text.
 *
 * The deployment's own model route carries the image (`input: [text, image]`
 * on the provider row); images are stored through `ctx.attachments` first so
 * the durable bytes are content-addressed like every other model-visible
 * image, and the model call is the same one-system-one-user-message shape as
 * every other call in this plugin. The transcription is deliberately literal:
 * it transcribes what the page shows (units, signs, option letters, figure
 * labels as prose) and never answers the question — answering is the solver's
 * job, and a hallucinated answer baked into the stem would poison the bank.
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { PaperModelRoute } from './draft.ts'

/** One image to transcribe, as the wire layer received it. */
export interface TranscribeImage {
  /** Decoded image bytes. */
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
  /** Display name carried onto the durable attachment; never a path. */
  readonly name?: string
}

const SYSTEM = `你是中学物理/化学试卷的转录员。把图片里的题目完整转成可入库文本，不要解题、不要补全、不要改写。

规则：
1. 逐字转录题面：保留题号、单位、正负号、上下标、取值范围、括号与选项字母（A. B. C. D.）。
2. 图片里的图（斜面、电路、光路、装置）用一句文字描述关键信息，写成「（图：…）」，不要臆测图中没有的数值。
3. 一图多题时按题号分段，每题一段，段间空一行。
4. 图片模糊或字符无法确认时，用「□」占位并在该题末尾加「（此处不清）」——不要猜。
5. 只输出转录文本本身，不要任何解释、标题或 Markdown 代码块。`

/** Per-attempt bound on one transcription stream; vision models are slow. */
const TRANSCRIBE_TIMEOUT_MS = 180_000

/**
 * Transcribe one or more question images into ingestable text.
 * @param ctx - plugin context carrying `llm` and `attachments`.
 * @param route - the deployment's provider/model pair; the model must accept
 *   image input (the adapter refuses an image block on a text-only model).
 * @param images - decoded images in page order.
 * @returns the transcription text, ready for `ingestBankText`.
 */
export async function transcribeQuestionImages(
  ctx: Context,
  route: PaperModelRoute,
  images: readonly TranscribeImage[],
): Promise<string> {
  if (images.length === 0) throw new Error('transcribe needs at least one image')
  const limits = ctx.attachments.imageLimits
  if (images.length > limits.maxImagesPerMessage) {
    throw new Error(`一次最多转录 ${limits.maxImagesPerMessage} 张图片（收到 ${images.length} 张）`)
  }
  const content: Array<Parameters<typeof createUserMessage>[0]['content'][number]> = [
    { type: 'text', text: '转录以下题目图片。' },
  ]
  for (const image of images) {
    await ctx.attachments.validateImage({
      data: image.data,
      mediaType: image.mediaType,
      ...image.name === undefined ? {} : { name: image.name },
    })
    const attachment = await ctx.attachments.saveImage({
      data: image.data,
      mediaType: image.mediaType,
      ...image.name === undefined ? {} : { name: image.name },
    })
    content.push({ type: 'image', attachment })
  }

  const assembler = new BlockAssembler()
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, TRANSCRIBE_TIMEOUT_MS)
  try {
    for await (const chunk of ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM,
      messages: [createUserMessage({ content, source: { kind: 'user' } })],
      maxTokens: 16000,
      temperature: 0.1,
      signal: controller.signal,
    })) {
      assembler.push(chunk)
    }
  } finally {
    clearTimeout(timeout)
  }
  const finish = assembler.finish
  if (finish.kind === 'error') {
    throw new Error(`题图转录失败：${finish.failure.message}（${finish.failure.code}）`)
  }
  if (finish.kind === 'aborted') throw new Error('题图转录超时或被中断')
  const text = assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (text.length === 0) throw new Error('题图转录返回了空文本')
  return text
}
