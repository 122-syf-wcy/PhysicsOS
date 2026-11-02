import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const errors = []
const directoryPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const filePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.test|\.spec|\.client\.spec)?\.tsx?$|^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.module\.css$/
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) { errors.push(path + ': symlinks are not source directories'); continue }
    if (entry.isDirectory()) {
      if (!directoryPattern.test(entry.name)) errors.push(path)
      await walk(path)
    } else if (/\.(tsx?|css)$/.test(entry.name) && !filePattern.test(entry.name)) {
      errors.push(path)
    }
  }
}
await walk('src')
if (errors.length > 0) {
  console.error('Use kebab-case source paths:\n' + errors.join('\n'))
  process.exitCode = 1
} else console.log('Source names passed')
