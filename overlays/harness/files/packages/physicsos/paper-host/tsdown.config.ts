/**
 * Node-side library bundle for the PhysicsOS paper host plugin.
 *
 * Host-plane row (webServer routes, storage domain, LLM calls), so it only
 * has a Node half. `@physicsos/*` is a `link:` bridge onto PhysicsOS'
 * TypeScript sources, which the Node loader cannot import at runtime — the
 * question-paper graph is inlined into `lib/index.js`, while every
 * `@deepseek-ai/*` package stays external.
 */
import { defineConfig, type UserConfig } from 'tsdown'

const SKIP: UserConfig = { entry: '' }

const nodeLibrary: UserConfig = {
  name: '@deepseek-ai/dsh-paper-host',
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { alwaysBundle: [/^@physicsos\//] },
}

export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE
  if (face !== undefined && face !== 'host' && face !== 'client') {
    throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(face)}`)
  }
  return face === 'client' ? [SKIP] : [nodeLibrary]
})
