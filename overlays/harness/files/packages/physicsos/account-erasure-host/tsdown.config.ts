/**
 * Node-side library bundle for the composite account-erasure provider.
 */
import { defineConfig, type UserConfig } from 'tsdown'

const SKIP: UserConfig = { entry: '' }

const nodeLibrary: UserConfig = {
  name: '@deepseek-ai/dsh-account-erasure-host',
  entry: ['lib/types/index.js'],
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
