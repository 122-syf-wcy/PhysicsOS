#!/usr/bin/env node
/** Check bounded file batches against the SAME complete aggregate program. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
const json = async file => JSON.parse(await readFile(file, 'utf8'))

export function partitionTargets(sourceFiles, batchSize = 96) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error('Invalid aggregate batch size')
  const names = sourceFiles.map(file => file.fileName)
  if (new Set(names).size !== names.length) throw new Error('Duplicate aggregate source files')
  const declarations = sourceFiles.filter(file => file.isDeclarationFile).map(file => file.fileName)
  const implementation = sourceFiles.filter(file => !file.isDeclarationFile).map(file => file.fileName)
  const batches = []
  for (let at = 0; at < implementation.length; at += batchSize) batches.push(implementation.slice(at, at + batchSize))
  if (!batches.length) batches.push([])
  batches[0].unshift(...declarations)
  const checked = batches.flat()
  if (checked.length !== names.length || new Set(checked).size !== names.length || names.some(name => !checked.includes(name)))
    throw new Error('Aggregate partition must cover every source file exactly once')
  return batches
}

function readAggregateConfig(ts, configFile) {
  const source = ts.readConfigFile(configFile, ts.sys.readFile)
  if (source.error) throw new Error(ts.flattenDiagnosticMessageText(source.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(source.config, ts.sys, dirname(configFile), undefined, configFile)
  if (parsed.options.noEmit !== true || parsed.options.noCheck === true) throw new Error('The original checked noEmit aggregate is required')
  return parsed
}

export function createAggregateProgram(ts, configFile) {
  const parsed = readAggregateConfig(ts, configFile)
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: parsed.errors })
  return { parsed, program }
}

export function checkTargets(ts, parsed, program, targets) {
  const files = new Map(program.getSourceFiles().map(file => [file.fileName, file]))
  if (new Set(targets).size !== targets.length || targets.some(name => !files.has(name))) throw new Error('Unknown or repeated aggregate target')
  const diagnostics = [...program.getConfigFileParsingDiagnostics(), ...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics()]
  for (const name of targets) {
    const file = files.get(name)
    diagnostics.push(...program.getSemanticDiagnostics(file))
    if (parsed.options.declaration || parsed.options.composite) diagnostics.push(...program.getDeclarationDiagnostics(file))
  }
  return diagnostics.map(item => ({ file: item.file?.fileName, start: item.start, length: item.length, code: item.code,
    category: item.category, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') }))
}

function fingerprint(parsed, program) {
  const files = Object.fromEntries(program.getSourceFiles().map(file => [file.fileName, digest(file.text)]))
  const options = Object.fromEntries(Object.entries(parsed.options).filter(([name]) => name !== 'configFile'))
  return { rootNamesDigest: digest(parsed.fileNames), referencesDigest: digest(parsed.projectReferences ?? []),
    optionsDigest: digest(options), sourceFilesDigest: digest(files), sourceFiles: files }
}

async function runWorker(config) {
  const ts = createRequire(join(config.root, 'package.json'))('typescript')
  const { parsed, program } = createAggregateProgram(ts, config.configFile)
  const actual = fingerprint(parsed, program)
  for (const name of ['rootNamesDigest', 'referencesDigest', 'optionsDigest', 'sourceFilesDigest'])
    if (actual[name] !== config.fingerprint[name]) throw new Error('Aggregate inputs changed between batches')
  const started = Date.now()
  const diagnostics = checkTargets(ts, parsed, program, config.targets)
  const result = { checked: config.targets, fingerprint: Object.fromEntries(Object.entries(actual).filter(([name]) => name !== 'sourceFiles')),
    typescriptVersion: ts.version, diagnostics, seconds: (Date.now() - started) / 1000,
    ok: diagnostics.every(item => item.category !== ts.DiagnosticCategory.Error) }
  await writeFile(config.output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
}

async function native(command, args, options = {}) {
  const { timeoutMs = 300_000, ...spawnOptions } = options
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions })
  const timer = setTimeout(() => { child.kill('SIGTERM') }, timeoutMs)
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 16 * 1024 * 1024) child.kill('SIGTERM') })
  child.stderr.on('data', chunk => { errors += chunk; if (errors.length > 16 * 1024 * 1024) child.kill('SIGTERM') })
  let result
  try { result = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolveExit({ code, signal })) }) }
  finally { clearTimeout(timer) }
  return { ...result, output, errors }
}

export async function checkAggregate({ root, configFile, outputDir, batchSize = 96, heapMiB = 2048 }) {
  root = resolve(root); configFile = resolve(root, configFile); outputDir = resolve(outputDir)
  if (!['tsconfig.host.json', 'tsconfig.client.json'].some(name => configFile === join(root, name))) throw new Error('Use an original host or client aggregate at the workspace root')
  if (!Number.isInteger(heapMiB) || heapMiB < 512 || heapMiB > 3584) throw new Error('Invalid aggregate heap budget')
  try { await access(outputDir); throw new Error('Aggregate evidence directory already exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(outputDir, { recursive: true, mode: 0o700 })
  const require = createRequire(join(root, 'package.json')), ts = require('typescript')
  const config = readAggregateConfig(ts, configFile)
  // Referenced projects are checked by the original compiler before taking the input inventory.
  const references = config.projectReferences?.map(item => item.path) ?? []
  if (references.length) {
    const compiler = require.resolve('typescript/bin/tsc')
    const reference = await native(process.execPath, [compiler, '-b', ...references, '--pretty', 'false'],
      { cwd: root, env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${heapMiB}` } })
    await writeFile(join(outputDir, 'references.log'), reference.output + reference.errors, { mode: 0o600 })
    await writeFile(join(outputDir, 'references.json'), JSON.stringify({ exitCode: reference.code, signal: reference.signal, count: references.length }) + '\n', { mode: 0o600 })
    if (reference.code !== 0) throw new Error('Aggregate reference checking failed; no batch was skipped')
  }
  let { parsed, program } = createAggregateProgram(ts, configFile)
  const inputs = fingerprint(parsed, program)
  const sourceFileCount = program.getSourceFiles().length
  if (!parsed.fileNames.length || !sourceFileCount) throw new Error('An empty program cannot attest aggregate coverage')
  const batches = partitionTargets(program.getSourceFiles(), batchSize)
  await writeFile(join(outputDir, 'inputs.json'), JSON.stringify({ configFile, typescriptVersion: ts.version, ...inputs }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  // Do not keep the parent AST/type caches alive alongside the checking process.
  parsed = undefined; program = undefined
  const expectedFingerprint = Object.fromEntries(Object.entries(inputs).filter(([name]) => name !== 'sourceFiles'))
  const diagnostics = [], checked = new Set(), results = []
  const script = fileURLToPath(import.meta.url)
  for (const [index, targets] of batches.entries()) {
    const input = join(outputDir, `batch-${index}.input.json`), output = join(outputDir, `batch-${index}.result.json`)
    await writeFile(input, JSON.stringify({ root, configFile, targets, output, fingerprint: expectedFingerprint }) + '\n', { mode: 0o600, flag: 'wx' })
    const child = await native(process.execPath, [`--max-old-space-size=${heapMiB}`, script, '--worker-file', input], { cwd: root })
    await writeFile(join(outputDir, `batch-${index}.log`), child.output + child.errors, { mode: 0o600 })
    if (child.code !== 0) throw new Error(`Aggregate batch ${index} could not finish; evidence is retained`)
    const result = await json(output)
    if (canonical(result.checked) !== canonical(targets) || result.typescriptVersion !== ts.version) throw new Error('Aggregate batch coverage/version differs')
    for (const name of ['rootNamesDigest', 'referencesDigest', 'optionsDigest', 'sourceFilesDigest'])
      if (result.fingerprint[name] !== inputs[name]) throw new Error('Aggregate batch fingerprint differs')
    for (const file of result.checked) { if (checked.has(file)) throw new Error('Aggregate file checked more than once'); checked.add(file) }
    diagnostics.push(...result.diagnostics); results.push({ index, files: result.checked.length, seconds: result.seconds, ok: result.ok })
    console.log(JSON.stringify({ batch: index, completed: results.length, total: batches.length, checked: checked.size }))
  }
  const unique = [...new Map(diagnostics.map(item => [canonical(item), item])).values()]
  const errors = unique.filter(item => item.category === ts.DiagnosticCategory.Error)
  if (checked.size !== sourceFileCount || Object.keys(inputs.sourceFiles).some(name => !checked.has(name))) throw new Error('Aggregate coverage incomplete')
  const report = { configFile, typescriptVersion: ts.version, fullProgramPerBatch: true, rootNamesUnchanged: true, optionsUnchanged: true,
    projectReferencesUnchanged: true, allGlobalMergesPreserved: true, sourceFileCount: checked.size, batchCount: batches.length,
    fingerprint: Object.fromEntries(Object.entries(inputs).filter(([name]) => name !== 'sourceFiles')), results, diagnostics: unique.length, errors: errors.length, ok: errors.length === 0 }
  await writeFile(join(outputDir, 'diagnostics.json'), JSON.stringify(unique, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await writeFile(join(outputDir, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  return report
}

async function main(args) {
  if (args[0] === '--worker-file' && args.length === 2) return runWorker(await json(args[1]))
  const values = {}
  for (let at = 0; at < args.length; at += 2) {
    if (!['--root', '--config', '--output-dir', '--batch-size', '--heap-mib'].includes(args[at]) || args[at + 1] === undefined) throw new Error('Expected named aggregate-check arguments')
    values[args[at]] = args[at + 1]
  }
  if (!values['--root'] || !values['--config'] || !values['--output-dir']) throw new Error('Use --root, --config and --output-dir')
  const result = await checkAggregate({ root: values['--root'], configFile: values['--config'], outputDir: values['--output-dir'],
    batchSize: values['--batch-size'] === undefined ? 96 : Number(values['--batch-size']), heapMiB: values['--heap-mib'] === undefined ? 2048 : Number(values['--heap-mib']) })
  console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => { console.error('aggregate-check: ' + error.message); process.exitCode = 1 })
