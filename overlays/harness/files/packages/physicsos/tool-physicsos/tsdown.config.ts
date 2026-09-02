/**
 * Node-side library bundle for the PhysicsOS tool plugin.
 *
 * The plugin is a host-plane row (it registers into `ctx.tools`), so it only
 * has a Node half. `@physicsos/*` is a `link:` bridge onto PhysicsOS' TypeScript
 * sources (see docs/HARNESS-UI-OVERLAY.md, DEV INTEGRATION BRIDGE), which the
 * Node loader cannot import at runtime — so the whole PhysicsOS domain graph is
 * inlined into `lib/index.js`, while every `@deepseek-ai/*` package stays
 * external and is resolved from the host assembly like any other plugin.
 *
 * A package-level config REPLACES the root workspace layout for this package,
 * so the Client pass must be told there is nothing to emit here.
 */
import { defineConfig, type UserConfig } from 'tsdown'

const SKIP: UserConfig = { entry: '' }

const nodeLibrary: UserConfig = {
  name: '@deepseek-ai/dsh-tool-physicsos',
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { alwaysBundle: [/^@physicsos\//] },
}

export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE
  if (face !== undefined && face !== 'host' && face !== 'client') {
    throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(face)}`)
  }
  return face === 'client' ? [SKIP] : [nodeLibrary]
})
