import { clientBundle } from '../tsdown.client.ts'
import type { UserConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopAccountFingerprint } from '../../../scripts/desktop-account-fingerprint.ts'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-settings-account'
const OPTIONAL_FILE = 'optional-desktop-account.js'
const bundle = clientBundle(PLUGIN_ID, ['lib/types/index.js'])

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
