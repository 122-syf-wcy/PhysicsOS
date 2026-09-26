import path from 'node:path'
import { fileURLToPath } from 'node:url'

const vendorRoot =
  process.env['PHYSICSOS_VENDOR_ROOT'] ??
  fileURLToPath(new URL('../../../../../../vendor/deepseek-harness/', import.meta.url))

export default {
  root: vendorRoot,
  resolve: {
    alias: {
      '@deepseek-ai/cordis': path.join(vendorRoot, 'vendor/cordis/src/index.ts'),
      '@deepseek-ai/cosmokit': path.join(vendorRoot, 'vendor/cosmokit/src/index.ts'),
      '@deepseek-ai/schemastery': path.join(vendorRoot, 'vendor/schemastery/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [fileURLToPath(new URL('tests/**/*.spec.ts', import.meta.url))],
  },
}
