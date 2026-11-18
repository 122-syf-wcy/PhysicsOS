import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'

const vendorRoot = fileURLToPath(
  new URL('../../../../../../vendor/deepseek-harness/', import.meta.url),
)

export default {
  root: vendorRoot,
  plugins: [tsconfigPaths({ projects: [path.join(vendorRoot, 'tsconfig.base.json')] })],
  resolve: {
    alias: {
      '@deepseek-ai/cordis': path.join(vendorRoot, 'vendor/cordis/src/index.ts'),
      '@deepseek-ai/cosmokit': path.join(vendorRoot, 'vendor/cosmokit/src/index.ts'),
      '@deepseek-ai/dsh-host-webserver': path.join(
        vendorRoot,
        'packages/host/webserver/src/index.ts',
      ),
      '@deepseek-ai/dsh-storage-domain': path.join(
        vendorRoot,
        'packages/storage/storage-domain/src/index.ts',
      ),
      '@deepseek-ai/dsh-storage': path.join(
        vendorRoot,
        'packages/storage/storage/src/index.ts',
      ),
      '@deepseek-ai/dsh-llm': path.join(vendorRoot, 'packages/llm/llm/src/index.ts'),
      '@deepseek-ai/dsh-llm-pi-ai': path.join(vendorRoot, 'packages/llm/llm-pi-ai/src/index.ts'),
      '@deepseek-ai/schemastery': path.join(vendorRoot, 'vendor/schemastery/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [fileURLToPath(new URL('tests/**/*.spec.ts', import.meta.url))],
  },
}
