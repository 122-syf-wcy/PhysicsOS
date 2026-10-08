import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Detect the cross-checkout links and duplicate React instances that invalidate UI tests. */
export function inspectClientDependencies(root) {
  const errors = []
  const paths = {}
  try {
    const base = realpathSync(root)
    const client = createRequire(
      resolve(base, 'vendor/deepseek-harness/packages/client/ui-physicsos/package.json'),
    )
    const renderer = createRequire(client.resolve('@testing-library/react'))
    const dom = createRequire(client.resolve('react-dom'))
    for (const [name, require, specifier] of [
      ['client React', client, 'react'],
      ['client React DOM', client, 'react-dom'],
      ['test renderer', client, '@testing-library/react'],
      ['test React', renderer, 'react'],
      ['test React DOM', renderer, 'react-dom'],
      ['React DOM peer', dom, 'react'],
    ]) {
      const file = realpathSync(require.resolve(specifier))
      paths[name] = file
      const rel = relative(base, file)
      if (rel.startsWith('..') || isAbsolute(rel))
        errors.push(`${name} resolves outside this checkout: ${file}`)
    }
    for (const name of ['test React', 'React DOM peer']) {
      if (paths[name] !== paths['client React'])
        errors.push(`${name} uses a different React instance`)
    }
    if (paths['test React DOM'] !== paths['client React DOM'])
      errors.push('test renderer uses a different React DOM instance')
  } catch (error) {
    errors.push(`dependency resolution failed: ${error.message}`)
  }
  return { errors, paths }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const result = inspectClientDependencies(root)
  if (result.errors.length) {
    console.error(result.errors.join('\n'))
    console.error(
      'Reinstall both workspaces in this checkout; do not reuse node_modules symlinks from another worktree.',
    )
    process.exitCode = 1
  } else
    console.log(
      'Dependency isolation verified: UI and test renderer share React and React DOM in this checkout.',
    )
}
