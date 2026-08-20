/**
 * Integration boundary.
 *
 * This package is the ONLY PhysicsOS package allowed to import DeepSeek Harness
 * APIs. PHASE-01 does not import Harness internals yet: the mapping is declared
 * here so later work cannot leak Harness types into apps/web or physics-core.
 */
export const DSH_INTEGRATION_BOUNDARY = {
  packageName: '@physicsos/agent-dsh-adapter',
  upstreamPath: 'vendor/deepseek-harness',
  allowedConsumers: ['apps/web via PhysicsAgentRuntime only', 'future agent service'],
  forbidden: [
    'apps/web must not import vendor/deepseek-harness',
    'packages/ui must not import DeepSeek Harness',
    'packages/agent-runtime must not import DeepSeek Harness',
    'Do not rewrite Harness Agent Loop / Session Store / Web UI',
  ],
} as const

export interface DeepSeekHarnessAdapterOptions {
  /**
   * Future: base URL of a Harness-compatible Agent service.
   * Not a browser-side secret. Real credentials stay server-side.
   */
  baseUrl?: string
}
