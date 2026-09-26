import { defineConfig, type UserConfig } from 'tsdown'

const nodeLibrary: UserConfig = {
  name: '@deepseek-ai/dsh-shared-state-host',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default defineConfig(() => [nodeLibrary])
