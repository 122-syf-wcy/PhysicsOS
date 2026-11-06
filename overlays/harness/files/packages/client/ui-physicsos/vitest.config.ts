import { isBuiltin } from 'node:module'
import base from '../../../vitest.config.ts'

// jsdom runs in Node. Vite 8's client transform otherwise replaces Node
// imports in the shared setup files with browser-only external stubs.
const nodeBuiltins = {
  name: 'physicsos-test-node-builtins',
  enforce: 'pre' as const,
  resolveId(id: string) {
    return isBuiltin(id) ? { id, external: true } : undefined
  },
}

export default {
  ...base,
  plugins: [nodeBuiltins, ...base.plugins],
  test: {
    ...base.test,
    env: { NODE_ENV: 'test' },
    projects: base.test.projects.map(project => typeof project === 'object' ? {
      ...project,
      plugins: [nodeBuiltins, ...project.plugins],
      test: { ...project.test, env: { NODE_ENV: 'test' } },
    } : project),
  },
}
