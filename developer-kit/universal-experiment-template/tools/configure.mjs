import { readFile, writeFile } from 'node:fs/promises'
const args = process.argv.slice(2)
const versionIndex = args.indexOf('--version')
const version = versionIndex < 0 ? undefined : args[versionIndex + 1]
if (!version || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version) || args.length !== 2) throw new Error('Usage: npm run configure -- --version X.Y.Z')
for (const name of ['experiment.json', 'package.json']) {
  const value = JSON.parse(await readFile(name, 'utf8'))
  value.version = version
  await writeFile(name, JSON.stringify(value, null, 2) + '\n')
}
const lock = await readFile('package-lock.json', 'utf8').catch(() => undefined)
if (lock) {
  const value = JSON.parse(lock)
  value.version = version
  if (value.packages?.['']) value.packages[''].version = version
  await writeFile('package-lock.json', JSON.stringify(value, null, 2) + '\n')
}
console.log(`Configured version ${version}; run npm run release to build and validate`)
