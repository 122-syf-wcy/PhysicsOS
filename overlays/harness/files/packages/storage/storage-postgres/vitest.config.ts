import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const overlayVendorRoot = path.resolve(configDir, '../../../../../../vendor/deepseek-harness')
const copiedVendorRoot = path.resolve(configDir, '../../..')
const vendorRoot = existsSync(path.join(overlayVendorRoot, 'packages/storage/storage/src/index.ts'))
  ? overlayVendorRoot
  : copiedVendorRoot

export default {
  root: vendorRoot,
  resolve: {
    alias: {
      '@deepseek-ai/cordis': path.join(vendorRoot, 'vendor/cordis/src/index.ts'),
      '@deepseek-ai/cosmokit': path.join(vendorRoot, 'vendor/cosmokit/src/index.ts'),
      '@deepseek-ai/dsh-invariants': path.join(
        vendorRoot,
        'packages/runtime-diagnostics/invariants/src/index.ts',
      ),
      '@deepseek-ai/dsh-storage': path.join(vendorRoot, 'packages/storage/storage/src/index.ts'),
      '@deepseek-ai/schemastery': path.join(vendorRoot, 'vendor/schemastery/src/index.ts'),
      '../../storage/tests/contract.ts': path.join(
        vendorRoot,
        'packages/storage/storage/tests/contract.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    hookTimeout: 30_000,
    include: [fileURLToPath(new URL('tests/**/*.spec.ts', import.meta.url))],
    testTimeout: 30_000,
  },
}
