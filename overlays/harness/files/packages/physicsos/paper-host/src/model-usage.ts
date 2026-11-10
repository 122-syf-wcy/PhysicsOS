import { copyModelUsage, type ModelUsage } from '@physicsos/model-usage-outbox'
import type { BlockAssembler } from '@deepseek-ai/dsh-llm'
/** Failed transport defaults are unknown usage; successful explicit zero remains a real report. */
export function paperUsageOf(assembler: BlockAssembler): ModelUsage | undefined {
  let usage: ModelUsage | undefined
  try { usage = copyModelUsage(assembler.usage) } catch { return undefined }
  if (usage && assembler.finish.kind !== 'stop' && !assembler.blocks().some(block => block.type === 'text' && block.text.length > 0)
    && Object.values(usage).every(value => value === 0)) return undefined
  return usage
}
