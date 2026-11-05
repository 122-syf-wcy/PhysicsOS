import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import base from '../../../vitest.config.ts'

// Built dependencies can import the same scoped services as source tests.
// Resolve both to source so identity-based scope keys have one module owner.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const paths = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alias = Object.entries(paths).filter(([name]) => !name.includes('*')).map(([name, targets]) => ({
  find: new RegExp(`^${escape(name)}$`), replacement: resolve(root, (targets as string[])[0]),
}))

export default {
  ...base,
  root,
  resolve: { ...base.resolve, alias },
  test: {
    ...base.test,
    projects: base.test.projects.map(project => typeof project === 'object' ? {
      ...project, resolve: { ...project.resolve, alias },
    } : project),
  },
}
