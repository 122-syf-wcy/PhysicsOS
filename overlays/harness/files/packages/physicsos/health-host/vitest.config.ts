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
    /* Resolve the specs (and their tsconfig `extends` chain) inside the vendor
       tree: this config is executed from CI against the overlay copy, where an
       overlay-relative include would leave vite unable to load a tsconfig. */
    include: [
      path.join(vendorRoot, 'packages/physicsos/health-host/tests/**/*.spec.ts'),
    ],
  },
}
