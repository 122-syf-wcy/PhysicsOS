import type { en } from './locales.ts'

/**
 * Human label for a pi-ai wire protocol. Unknown ids stay as the adapter name.
 * @param api - protocol identifier from the namespace schema.
 * @param t - Models copy.
 */
export function protocolLabel(api: string, t: (key: keyof typeof en) => string): string {
  if (api === 'openai-completions') return t('protocolChat')
  if (api === 'openai-responses') return t('protocolResponses')
  if (api === 'anthropic-messages') return t('protocolAnthropic')
  return api
}
