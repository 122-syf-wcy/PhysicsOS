/**
 * Node-side bundle for the liveness/readiness host plugin.
 */
import { defineConfig, type UserConfig } from 'tsdown'

const SKIP: UserConfig = { entry: '' }

const nodeLibrary: UserConfig = {
  name: '@deepseek-ai/dsh-health-host',
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
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
