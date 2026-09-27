import type { ModelsKey } from './locales.ts'
import { protocolLabel as labelForProtocol } from './protocol-label.ts'

/**
 * Human label for a pi-ai wire protocol. Unknown ids stay as the adapter name.
 * @param api - protocol identifier from the namespace schema.
 * @param t - Models copy.
 * @returns the localized label, or `api` itself when the id is unknown.
 */
export function protocolLabel(api: string, t: (key: ModelsKey) => string): string {
  return labelForProtocol(t, api)
}
