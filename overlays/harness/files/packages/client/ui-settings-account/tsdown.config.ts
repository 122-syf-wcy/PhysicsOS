import { clientBundle } from '../tsdown.client.ts'
import type { UserConfig } from 'tsdown'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-settings-account'
const OPTIONAL_FILE = 'optional-desktop-account.js'
const bundle = clientBundle(PLUGIN_ID, ['lib/types/index.js'])

/** Keep the parent's immutable resource revision coupled to every local desktop input. */
export function desktopAccountFingerprint(root: string): string {
  const files = ['tsdown.config.ts', 'package.json']
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`
      if (entry.isDirectory()) visit(name)
      else files.push(name)
    }
  }
  visit('src')
  const hash = createHash('sha256').update('desktop-account-inputs\0')
  for (const name of files.sort()) {
    const bytes = readFileSync(join(root, name))
    hash.update(`${Buffer.byteLength(name)}:${name}${bytes.length}:`).update(bytes)
  }
  return hash.digest('hex')
}

const withAssets = (config: UserConfig): UserConfig => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'account-onboarding-assets',
    resolveId(source: string) {
      if (!/^\.\/assets\/[^/]+\.(?:svg|png)(\?raw)?$/.test(source)) return null
      const url = new URL(`./src/client/assets/${basename(source)}`, import.meta.url)
      return fileURLToPath(url) + url.search
    },
    async load(id: string) {
      if (!/\/ui-settings-account\/src\/client\/assets\/[^/]+\.(?:svg|png)(\?raw)?$/.test(id.replaceAll('\\', '/'))) return null
      const path = id.replace(/\?raw$/, '')
      this.addWatchFile(path)
      const data = await readFile(path)
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(data.toString('utf8'))}`
      return `export default ${JSON.stringify(`data:${path.endsWith('.png') ? 'image/png' : 'image/svg+xml'};base64,${data.toString('base64')}`)}`
    },
  }],
})

export default ((options) => bundle(options).flatMap((base) => {
  const config = withAssets(base)
  if (!String(config.name ?? '').endsWith('/client')) return [config]
  const client: UserConfig = {
    ...config,
    define: {
      ...config.define,
      __DSH_DESKTOP_ACCOUNT_BUNDLE__: 'true',
      __DSH_DESKTOP_ACCOUNT_REVISION__: JSON.stringify(desktopAccountFingerprint(fileURLToPath(new URL('.', import.meta.url)))),
    },
    outputOptions: { ...config.outputOptions, inlineDynamicImports: true },
  }
  return [client, {
    ...client,
    name: `${PLUGIN_ID}/${OPTIONAL_FILE}`,
    entry: { desktop: 'src/client/desktop-account.ts' },
    sourcemap: false,
    outputOptions: {
      ...client.outputOptions,
      entryFileNames: OPTIONAL_FILE,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(`${PLUGIN_ID}/${OPTIONAL_FILE}`)}, factory: require => {`,
    },
  }]
})) satisfies typeof bundle
