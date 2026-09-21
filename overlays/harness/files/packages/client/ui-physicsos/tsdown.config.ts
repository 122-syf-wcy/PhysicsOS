import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const base = clientBundle('@deepseek-ai/dsh-client-ui-physicsos', ['lib/types/index.js', 'lib/types/invariant.js'])

/**
 * question-upload.ts loads pdf.js through `import()` so jsdom tests and
 * image-only sessions never evaluate it. The client artifact must stay ONE
 * file: the loader's require only resolves the module table (plugin ids),
 * never relative emitted chunks — so dynamic imports fold back into
 * client.js and still evaluate lazily.
 */
export default (inlineConfig: Pick<UserConfig, 'env'>): UserConfig[] =>
  base(inlineConfig).map((config) => {
    if (!String(config.name ?? '').endsWith('/client')) return config
    return {
      ...config,
      outputOptions: { ...config.outputOptions, inlineDynamicImports: true },
    }
  })
