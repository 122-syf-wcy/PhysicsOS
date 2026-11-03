/**
 * Node-side library bundle for the PhysicsOS 实验贡献 host plugin.
 *
 * Host-plane row (webServer routes, storage domain, package files on disk), so
 * it only has a Node half; every `@deepseek-ai/*` package stays external. The
 * identity contract is NOT imported from auth-host — the same independent-
 * workspace-members rule notice-host records.
 */
import { defineConfig, type UserConfig } from 'tsdown'

const SKIP: UserConfig = { entry: '' }

const nodeLibrary: UserConfig = {
  name: '@deepseek-ai/dsh-experiment-host',
  entry: ['lib/types/index.js', 'lib/types/routes.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE
  if (face !== undefined && face !== 'host' && face !== 'client') {
    throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(face)}`)
  }
  return face === 'client' ? [SKIP] : [nodeLibrary]
})
