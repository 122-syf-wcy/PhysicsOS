import path from 'node:path'
import { fileURLToPath } from 'node:url'

const vendorRoot = fileURLToPath(
  new URL('../../../../../../vendor/deepseek-harness/', import.meta.url),
)

export default {
  root: vendorRoot,
  resolve: {
    alias: {
      '@deepseek-ai/cordis': path.join(vendorRoot, 'vendor/cordis/src/index.ts'),
      '@deepseek-ai/cosmokit': path.join(vendorRoot, 'vendor/cosmokit/src/index.ts'),
      '@deepseek-ai/dsh-host-webserver': path.join(
        vendorRoot,
        'packages/host/webserver/src/index.ts',
      ),
      '@deepseek-ai/schemastery': path.join(vendorRoot, 'vendor/schemastery/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [fileURLToPath(new URL('tests/**/*.spec.ts', import.meta.url))],
  },
}
