/** Runtime image assets belong to one verified generation, never to the public library. */
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { crc32, inflateSync } from 'node:zlib'
import { cssReferences } from './html.ts'
export interface AssetBinding { ownerSessionId: string; ownerKey: string; generationId: string; sceneSha256: string }
export interface QuestionAssetDescriptor { path: string; cssPath: string; sha256: string; width: number; height: number; kind: 'environment' | 'material'; model: string }
export interface QuestionAssetFallback { status: 'unavailable'; mode: 'native'; code: 'IMAGE_TIMEOUT' | 'IMAGE_RATE_LIMIT' | 'IMAGE_SERVICE_UNAVAILABLE' }
export interface GenerateQuestionAssetInput extends AssetBinding { prompt: string; kind: 'environment' | 'material'; signal: AbortSignal }
interface StoredAsset { descriptor: QuestionAssetDescriptor; bytes: Buffer; prompt: string }
interface AssetJob { binding: AssetBinding; expires: number; attempts: number; assets: StoredAsset[]; fallbackCode?: QuestionAssetFallback['code'] }
interface Options { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }
const MAX_IMAGE = 6 * 1024 * 1024, MAX_BODY = 10 * 1024 * 1024, MAX_MEMORY = 64 * 1024 * 1024
const failure = (code: string): Error => Object.assign(new Error(code), { code })
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const sameBinding = (a: AssetBinding, b: AssetBinding): boolean =>
  a.ownerKey === b.ownerKey && a.ownerSessionId === b.ownerSessionId
  && a.generationId === b.generationId && a.sceneSha256 === b.sceneSha256
interface AssetToken { value: string; kind: 'word' | 'string' | 'number' | 'punctuation'; depth: number; division: boolean; end: number }
/** Small conservative lexical subset, not a JavaScript evaluator. Regex,
 * templates and ambiguous slash contexts disable constant resolution entirely;
 * the existing direct-literal/CSS checks remain available in those programs. */
function assetTokens(source: string, nativeTemplates = false): AssetToken[] | undefined {
  const tokens: AssetToken[] = [], groups: { close: string; division: boolean }[] = []
  const controls = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])
  const nonValues = new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'new', 'in', 'of', 'yield', 'await', 'else', 'do', 'instanceof'])
  for (let index = 0; index < source.length;) {
    const char = source[index] ?? '', next = source[index + 1], previous = tokens.at(-1)
    if (/\s/.test(char)) { index++; continue }
    if (char === '/' && next === '/') {
      index += 2
      while (index < source.length && !/[\r\n\u2028\u2029]/.test(source[index] ?? '')) index++
      continue
    }
    if (char === '/' && next === '*') { const end = source.indexOf('*/', index + 2); if (end < 0) return; index = end + 2; continue }
    if ((!nativeTemplates && char === '`') || char === '\\' || char.charCodeAt(0) > 127) return
    const start = index, depth = groups.length
    let kind: AssetToken['kind'] = 'punctuation', division = false
    if (char === '`') {
      index++
      while (index < source.length && source[index] !== '`') {
        if (source[index] === '\\') { index += 2; continue }
        if (source[index] === '$' && source[index + 1] === '{') {
          const end = source.indexOf('}', index + 2), expression = source.slice(index + 2, end)
          // Native geometry templates may read data and do arithmetic; calls,
          // assignments, updates and nested syntax cannot conceal DOM effects.
          if (end < 0 || !/^[\w$.[\]\s+*/%\-]+$/.test(expression) || /(?:\+\+|--|\b(?:document|window|globalThis|new|delete|await|yield|function|class|import)\b)/.test(expression)) return
          index = end + 1
        } else index++
      }
      if (source[index] !== '`') return
      index++; kind = 'string'; division = true
    } else if (char === '"' || char === "'") {
      index++
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') index += 2
        else { if (source[index] === '\n' || source[index] === '\r') return; index++ }
      }
      if (source[index] !== char) return
      index++; kind = 'string'; division = true
    } else if (/[A-Za-z_$]/.test(char)) {
      while (index < source.length && /[\w$]/.test(source[index] ?? '')) index++
      const word = source.slice(start, index)
      if (word === 'with') return
      kind = 'word'; division = !nonValues.has(word)
    } else if (/[0-9]/.test(char)) {
      while (index < source.length && /[\w.]/.test(source[index] ?? '')) index++
      kind = 'number'; division = true
    } else {
      // After a line terminator even a name/string may end a declaration via
      // ASI: the following slash can start a regex, not continue a division.
      // Without a grammar proof, retain only same-line division evidence.
      if (char === '/' && (!previous?.division || /[\r\n\u2028\u2029]/.test(source.slice(previous.end, index)))) return
      if (char === '(' || char === '[' || char === '{') {
        groups.push({ close: char === '(' ? ')' : char === '[' ? ']' : '}', division: char === '[' || (char === '(' && !controls.has(previous?.value ?? '')) })
      } else if (char === ')' || char === ']' || char === '}') {
        const group = groups.pop()
        if (group?.close !== char) return
        division = group.division
      }
      index++
    }
    tokens.push({ value: source.slice(start, index), kind, depth, division, end: index })
  }
  return groups.length ? undefined : tokens
}
const literal = (tokens: AssetToken[]): string | undefined => tokens.length === 1 && tokens[0]?.kind === 'string'
  && /^["']/.test(tokens[0].value) && !tokens[0].value.includes('\\') ? tokens[0].value.slice(1, -1) : undefined
const safePaint = (value: string | undefined): boolean => value !== undefined && (
  /^url\(#[\w-]+\)$/.test(value) || (!/\burl\s*\(/i.test(value) && /^[#\w(),.%\s-]+$/.test(value))
)
/** Native-only source has no dynamic DOM dispatch or URI-capable sinks. */
function validateNativeAssets(source: string): void {
  const tokens = assetTokens(source, true)
  if (!tokens) throw failure('IMAGE_BINDING_INVALID')
  const value = (index: number): string | undefined => tokens[index]?.value
  const closes = new Map<number, number>(), stack: number[] = [], mentions = new Map<string, number[]>(), tokenPositions = new Map<AssetToken, number>()
  const scopeAt: number[] = [], scopeParents = new Map<number, number>()
  let scope = -1
  tokens.forEach((token, index) => {
    tokenPositions.set(token, index)
    scopeAt[index] = scope
    if (token.kind === 'word') { const entries = mentions.get(token.value) ?? []; entries.push(index); mentions.set(token.value, entries) }
    if (token.kind !== 'punctuation') return
    if (token.value === '{') { scopeParents.set(index, scope); scope = index }
    else if (token.value === '}') scope = scopeParents.get(scope) ?? -1
    if (['(', '[', '{'].includes(token.value)) stack.push(index)
    else if ([')', ']', '}'].includes(token.value)) { const open = stack.pop(); if (open !== undefined) closes.set(open, index) }
  })
  const argsAt = (index: number): AssetToken[][] | undefined => {
    const open = tokens[index + 1]
    if (open?.value !== '(') return
    const args: AssetToken[][] = [[]]
    for (let at = index + 2; at < tokens.length; at++) {
      const token = tokens[at]!
      if (token.depth === open.depth + 1 && token.value === ')') return args
      if (token.depth === open.depth + 1 && token.value === ',') args.push([])
      else args.at(-1)!.push(token)
    }
    return
  }
  const dataScopes = new Map<string, number>(), palettes = new Set<string>(), declarations = new Map<string, number>()
  const visibleData = (name: string, index: number): boolean => {
    const declarationScope = dataScopes.get(name)
    if (declarationScope === undefined) return false
    let current = scopeAt[index] ?? -1
    while (current !== declarationScope && current !== -1) current = scopeParents.get(current) ?? -1
    return current === declarationScope
  }
  const shadowed = new Set<string>()
  for (let index = 0; index < tokens.length; index++) {
    if (['const', 'let', 'var'].includes(value(index) ?? '') && tokens[index + 1]?.kind === 'word') {
      const name = value(index + 1)!
      declarations.set(name, (declarations.get(name) ?? 0) + 1)
    }
    if (tokens[index]?.kind === 'word' && value(index - 1) === ',' && value(index + 1) === '=') {
      declarations.set(value(index)!, (declarations.get(value(index)!) ?? 0) + 1)
    }
    if (['const', 'let', 'var'].includes(value(index) ?? '') && ['[', '{'].includes(value(index + 1) ?? '')) {
      const end = closes.get(index + 1)
      if (end !== undefined) for (const token of tokens.slice(index + 2, end)) if (token.kind === 'word') shadowed.add(token.value)
    }
    if (value(index) === 'function') {
      const name = tokens[index + 1]?.kind === 'word' ? index + 1 : index
      for (const argument of argsAt(name) ?? []) for (const token of argument) if (token.kind === 'word') shadowed.add(token.value)
    }
    if (tokens[index]?.kind === 'word' && value(index + 1) === '=' && value(index + 2) === '>') shadowed.add(value(index)!)
    if (value(index) === '(') {
      const end = closes.get(index)
      const methodParameters = value(end === undefined ? -1 : end + 1) === '{' && tokens[index - 1]?.kind === 'word'
        && !['if', 'for', 'while', 'switch', 'with'].includes(value(index - 1) ?? '')
      if (end !== undefined && (value(end + 1) === '=' && value(end + 2) === '>' || methodParameters)) {
        for (const token of tokens.slice(index + 1, end)) if (token.kind === 'word') shadowed.add(token.value)
      }
    }
  }
  for (let index = 0; index < tokens.length; index++) {
    const name = value(index + 1), open = tokens[index + 3]
    if (value(index) !== 'const' || !name || declarations.get(name) !== 1 || shadowed.has(name) || value(index + 2) !== '=' || !['[', '{'].includes(open?.value ?? '')) continue
    const end = closes.get(index + 3)
    if (end === undefined || ![';', ',', ')'].includes(value(end + 1) ?? '')) continue
    dataScopes.set(name, scopeAt[index + 1] ?? -1)
    const contents = tokens.slice(index + 4, end)
    if (contents.length && contents.every((token, at) => [',', ':'].includes(token.value)
      || (token.kind === 'word' && contents[at + 1]?.value === ':') || safePaint(literal([token])))) {
      const uses = (mentions.get(name) ?? []).filter(at => at !== index + 1)
      if (uses.every(at => {
        if (value(at + 1) === '.') return value(at + 3) !== '=' && value(at + 3) !== '(' && !['+', '-'].includes(value(at + 3) ?? '')
        const close = closes.get(at + 1)
        return value(at + 1) === '[' && close !== undefined && !['=', '(', '+', '-', '*', '/', '%', '&', '|', '^'].includes(value(close + 1) ?? '')
      })) palettes.add(name)
    }
  }
  type ReadKind = 'json' | 'pure' | 'scalar' | 'dom' | 'unknown'
  interface ReadOrigin { kind: ReadKind; frame: boolean; owners?: Set<ReadBinding> }
  interface ReadFunction { name: string; declaration: number; parentScope: number; scope: number; end: number; parameters: ReadBinding[]; calls: number[] }
  interface ReadBinding { name: string; index: number; scope: number; initial?: AssetToken[] | undefined; parameter?: { fn: ReadFunction; index: number }; root?: boolean; changed: boolean; writes: { value: AssetToken[]; depth: number }[] }
  const unknown: ReadOrigin = { kind: 'unknown', frame: false }, scalar: ReadOrigin = { kind: 'scalar', frame: false }
  const readBindings = new Map<number, Map<string, ReadBinding[]>>(), functions = new Map<string, ReadFunction>(), declarationNames = new Set<number>()
  const addBinding = (binding: ReadBinding): void => {
    const names = readBindings.get(binding.scope) ?? new Map<string, ReadBinding[]>()
    names.set(binding.name, [...names.get(binding.name) ?? [], binding]); readBindings.set(binding.scope, names); declarationNames.add(binding.index)
  }
  const bindingAt = (name: string, index: number): ReadBinding | undefined => {
    let current = scopeAt[index] ?? -1
    for (;;) {
      const matches = readBindings.get(current)?.get(name)
      if (matches !== undefined) return matches.length === 1 ? matches[0] : undefined
      if (current === -1) return
      current = scopeParents.get(current) ?? -1
    }
  }
  const expressionEnd = (start: number, depth: number): number => {
    for (let at = start; at < tokens.length; at++) {
      if (tokens[at]!.depth === depth && [',', ';'].includes(value(at) ?? '') || tokens[at]!.depth <= depth && ['}', ')'].includes(value(at) ?? '')) return at
    }
    return tokens.length
  }
  for (let index = 0; index < tokens.length; index++) {
    if (value(index) === 'function' && tokens[index + 1]?.kind === 'word' && value(index + 2) === '(') {
      const close = closes.get(index + 2), body = close === undefined ? undefined : close + 1
      if (body === undefined || value(body) !== '{' || closes.get(body) === undefined) continue
      const fn: ReadFunction = { name: value(index + 1)!, declaration: index + 1, parentScope: scopeAt[index + 1] ?? -1, scope: body, end: closes.get(body)!, parameters: [], calls: [] }
      if (functions.has(fn.name) || functions.size >= 256) throw failure('IMAGE_BINDING_INVALID')
      functions.set(fn.name, fn); declarationNames.add(fn.declaration)
      for (const [position, argument] of (argsAt(index + 1) ?? []).entries()) {
        if (argument[0]?.kind !== 'word' || argument.length > 1 && argument[1]?.value !== '=') continue
        const parameter: ReadBinding = { name: argument[0].value, index: tokenPositions.get(argument[0])!, scope: body,
          parameter: { fn, index: position }, root: fn.name === 'renderFrame' && position === 0
            && (value(index - 1) === 'export' || value(index - 2) === 'export' && value(index - 1) === 'async'),
          initial: argument[1]?.value === '=' ? argument.slice(2) : undefined, changed: false, writes: [] }
        fn.parameters.push(parameter); addBinding(parameter)
      }
    }
    if (!['const', 'let', 'var'].includes(value(index) ?? '')) continue
    const depth: number = tokens[index]!.depth
    for (let at = index + 1; at < tokens.length; ) {
      if (tokens[at]?.kind !== 'word') break
      const end = value(at + 1) === '=' ? expressionEnd(at + 2, depth) : at + 1
      addBinding({ name: value(at)!, index: at, scope: scopeAt[at] ?? -1,
        initial: value(index) === 'const' && value(at + 1) === '=' ? tokens.slice(at + 2, end) : undefined, changed: false, writes: [] })
      if (value(end) !== ',' || tokens[end]?.depth !== depth) break
      at = end + 1
    }
  }
  for (const fn of functions.values()) {
    const uses = mentions.get(fn.name) ?? []
    if (uses.some(at => at !== fn.declaration && (value(at - 1) === '.' || value(at + 1) !== '('))) continue
    fn.calls = uses.filter(at => {
      if (at === fn.declaration || value(at - 1) === '.' || value(at + 1) !== '(' || bindingAt(fn.name, at)) return false
      let current = scopeAt[at] ?? -1
      while (current !== fn.parentScope && current !== -1) current = scopeParents.get(current) ?? -1
      return current === fn.parentScope
    })
  }
  const receiverStart = (end: number): number => {
    let start = end
    while (start >= 0) {
      if (value(start) === ']' || value(start) === ')') {
        const open = stackOpen.get(start)
        if (open === undefined) break
        start = open
        if (tokens[start - 1]?.kind === 'word') { start--; continue }
      }
      if (value(start - 1) === '.' && (tokens[start - 2]?.kind === 'word' || [']', ')'].includes(value(start - 2) ?? ''))) { start -= 2; continue }
      break
    }
    return Math.max(0, start)
  }
  const stackOpen = new Map<number, number>([...closes].map(([open, close]) => [close, open]))
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.kind !== 'word' || declarationNames.has(index) || value(index - 1) === '.') continue
    const binding = bindingAt(value(index)!, index)
    if (!binding) continue
    let end = index + 1, depth = 0
    while (value(end) === '.' && tokens[end + 1]?.kind === 'word' || value(end) === '[') {
      depth++
      end = value(end) === '[' ? (closes.get(end) ?? end) + 1 : end + 2
    }
    if (value(end) !== '=') continue
    if (!depth) binding.changed = true
    else binding.writes.push({ value: tokens.slice(end + 1, expressionEnd(end + 1, tokens[index]!.depth)), depth })
  }
  for (let index = 0; index < tokens.length; index++) {
    if (value(index - 1) === '.' && ['push', 'unshift', 'splice', 'fill'].includes(value(index) ?? '')) {
      const start = receiverStart(index - 2), name = value(start), binding = name ? bindingAt(name, start) : undefined
      if (!binding) continue
      const args = argsAt(index) ?? [], inserted = value(index) === 'splice' ? args.slice(2) : value(index) === 'fill' ? args.slice(0, 1) : args
      for (const argument of inserted) binding.writes.push({ value: argument, depth: 1 })
    }
    if (value(index) === 'Object' && value(index + 1) === '.' && value(index + 2) === 'assign') {
      const args = argsAt(index + 2) ?? [], target = args[0]
      if (target?.length !== 1 || target[0]?.kind !== 'word') continue
      const binding = bindingAt(target[0].value, tokenPositions.get(target[0])!)
      if (binding) for (const argument of args.slice(1)) binding.writes.push({ value: argument, depth: 1 })
    }
  }
  let frameChanged = false
  const dirtyOwners = new Set<ReadBinding>()
  const safeOrigin = (origin: ReadOrigin): boolean => ['json', 'pure', 'scalar'].includes(origin.kind)
  const scalarFields = new Set(['x', 'y', 'width', 'height', 'size', 'rotation', 'angle', 'time', 'text', 'label', 'symbol', 'role', 'observable', 'length'])
  const joinOrigins = (origins: ReadOrigin[], collection = false): ReadOrigin => !collection && origins.length === 1
    ? origins[0]! : origins.every(safeOrigin)
      ? { kind: 'pure', frame: origins.some(origin => origin.frame), owners: new Set(origins.flatMap(origin => [...origin.owners ?? []])) } : unknown
  const readBinding = (binding: ReadBinding, seen: Set<ReadBinding>, ignoreWrites = false): ReadOrigin => {
    if (seen.has(binding) || seen.size >= 64 || binding.changed) return unknown
    const next = new Set(seen).add(binding)
    let origin: ReadOrigin
    if (binding.root) origin = frameChanged ? unknown : { kind: 'json', frame: true, owners: new Set([binding]) }
    else if (binding.parameter) {
      const { fn, index } = binding.parameter
      origin = fn.calls.length ? joinOrigins(fn.calls.map(call => {
        const argument = argsAt(call)?.[index]
        return argument?.length ? readExpression(argument, call, next) : binding.initial ? readExpression(binding.initial, binding.index, next) : unknown
      })) : unknown
    } else origin = binding.initial ? readExpression(binding.initial, binding.index, next) : unknown
    if (origin.kind === 'pure' && (['[', '{'].includes(binding.initial?.[0]?.value ?? '') || !origin.owners?.size)) origin = { ...origin, owners: new Set([...origin.owners ?? [], binding]) }
    const written = binding.writes.map(write => readExpression(write.value, binding.index, next)).filter(safeOrigin)
    if (origin.kind === 'pure' && written.length) origin = { ...origin, owners: new Set([...origin.owners ?? [], ...written.flatMap(value => [...value.owners ?? []])]) }
    if (!ignoreWrites && [...origin.owners ?? []].some(owner => dirtyOwners.has(owner))) return unknown
    if (!ignoreWrites && binding.writes.length && (origin.kind === 'json' || binding.writes.some(write => !safeOrigin(readExpression(write.value, binding.index, next))))) return unknown
    return origin
  }
  const readExpression = (expression: AssetToken[], index: number, seen = new Set<ReadBinding>()): ReadOrigin => {
    const origins: ReadOrigin[] = [], collection = ['[', '{'].includes(expression[0]?.value ?? '')
    for (let at = 0; at < expression.length; at++) {
      const token = expression[at]!, name = token.value
      if (token.kind === 'string' || token.kind === 'number' || ['true', 'false', 'null', 'undefined'].includes(name)) { origins.push(scalar); continue }
      if (token.kind !== 'word' || expression[at - 1]?.value === '.' || expression[at + 1]?.value === ':' && ['{', ','].includes(expression[at - 1]?.value ?? '')) continue
      const actual = tokenPositions.get(token), binding = bindingAt(name, actual ?? index)
      let origin: ReadOrigin = binding ? readBinding(binding, seen) : unknown
      const builtin = !binding && !functions.has(name)
      if (builtin && ['document', 'Math', 'Object', 'String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isFinite', 'isNaN'].includes(name)) {
        if (name === 'document') origin = { kind: 'dom', frame: false }
        else origin = unknown
      }
      let end = at + 1
      while (end < expression.length) {
        if (expression[end]?.value === '.' && expression[end + 1]?.kind === 'word') {
          const property = expression[end + 1]!.value
          if (['constructor', 'prototype', '__proto__'].includes(property)) origin = unknown
          else if (origin.kind === 'dom') origin = ['clientWidth', 'clientHeight', 'width', 'height'].includes(property) ? scalar : { kind: 'dom', frame: false }
          else if (builtin && name === 'Math' && ['PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2'].includes(property)) origin = scalar
          else if (builtin && name === 'Number' && ['MAX_VALUE', 'MIN_VALUE', 'MAX_SAFE_INTEGER', 'MIN_SAFE_INTEGER', 'EPSILON'].includes(property)) origin = scalar
          else if (origin.kind === 'json' && scalarFields.has(property)) origin = scalar
          else if (origin.kind === 'scalar' && !(expression[end + 2]?.value === '(' && ['toFixed', 'toPrecision', 'toExponential', 'toString', 'trim', 'slice', 'substring'].includes(property))) origin = unknown
          end += 2
        } else if (expression[end]?.value === '[') {
          const globalOpen = tokenPositions.get(expression[end]!)!, close = closes.get(globalOpen), offset = close === undefined ? -1 : expression.indexOf(tokens[close]!)
          if (offset < end) return unknown
          if (!safeOrigin(origin) || ['constructor', 'prototype', '__proto__'].includes(literal(expression.slice(end + 1, offset)) ?? '')) origin = unknown
          end = offset + 1
        } else if (expression[end]?.value === '(') {
          const open = tokenPositions.get(expression[end]!)!, close = closes.get(open), offset = close === undefined ? -1 : expression.indexOf(tokens[close]!)
          if (offset < end) return unknown
          const call = end > at + 1 ? expression[end - 1]!.value : name
          const args = argsAt(tokenPositions.get(expression[end - 1]!)!) ?? []
          if (builtin && name === 'document' && ['getElementById', 'createElement', 'createElementNS'].includes(call)) origin = { kind: 'dom', frame: false }
          else if (origin.kind === 'dom' && call === 'getContext') origin = { kind: 'dom', frame: false }
          else if (builtin && (['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isFinite', 'isNaN'].includes(name) || name === 'Math') || origin.kind === 'scalar' && ['toFixed', 'toPrecision', 'toExponential', 'toString', 'trim', 'slice', 'substring'].includes(call)) origin = args.every(argument => safeOrigin(readExpression(argument, index, seen))) ? scalar : unknown
          else if (builtin && name === 'Object' && ['keys', 'values', 'entries', 'fromEntries'].includes(call)) {
            const argumentsOrigin = args.map(argument => readExpression(argument, index, seen))
            origin = argumentsOrigin.every(safeOrigin) ? { ...joinOrigins(argumentsOrigin, true), kind: 'pure' } : unknown
          }
          else if (!binding && end === at + 1 && functions.has(name)) {
            const fn = functions.get(name)!, returned: ReadOrigin[] = []
            for (let position = fn.scope + 1; position < fn.end; position++) if (value(position) === 'return') returned.push(readExpression(tokens.slice(position + 1, expressionEnd(position + 1, tokens[position]!.depth)), position, seen))
            origin = returned.length ? joinOrigins(returned) : unknown
          } else origin = unknown
          end = offset + 1
        } else break
      }
      origins.push(origin); at = end - 1
    }
    return joinOrigins(origins, collection)
  }
  for (let pass = 0; pass < 64; pass++) {
    const before = dirtyOwners.size, hadChangedFrame: boolean = frameChanged
    for (const names of readBindings.values()) for (const matches of names.values()) for (const binding of matches) {
      const origin = readBinding(binding, new Set(), true)
      if (origin.frame && binding.writes.some(write => origin.kind === 'json' || write.depth > 1)) frameChanged = true
      if (binding.writes.some(write => origin.kind === 'json' || !safeOrigin(readExpression(write.value, binding.index)))) {
        for (const owner of origin.owners ?? []) dirtyOwners.add(owner)
      }
    }
    if (before === dirtyOwners.size && hadChangedFrame === frameChanged) break
  }
  const paintArgument = (argument: AssetToken[], index: number): boolean => {
    if (safePaint(literal(argument))) return true
    const name = argument[0]?.value
    return Boolean(name && palettes.has(name) && visibleData(name, index) && (argument[1]?.value === '.' && argument.length === 3
      || argument[1]?.value === '[' && argument.at(-1)?.value === ']'
        && argument.slice(2, -1).every(token => token.kind === 'word' || token.kind === 'string' || token.kind === 'number' || ['.', '[', ']'].includes(token.value))))
  }
  const tags = new Set(['canvas', 'svg', 'g', 'path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'marker', 'pattern', 'title', 'desc'])
  const attributes = new Set(['cx', 'cy', 'x', 'y', 'r', 'rx', 'ry', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'd', 'points', 'transform', 'viewbox', 'preserveaspectratio', 'id', 'class', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'vector-effect', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'patternunits', 'patterncontentunits', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'xmlns'])
  const paintAttributes = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end'])
  const styleProperties = new Set(['width', 'height', 'minwidth', 'minheight', 'maxwidth', 'maxheight', 'position', 'inset', 'left', 'right', 'top', 'bottom', 'display', 'margin', 'padding', 'boxsizing', 'opacity', 'color', 'backgroundcolor', 'font', 'fontsize', 'fontfamily', 'fontweight', 'textalign', 'lineheight', 'overflow', 'pointerevents'])
  const forbidden = new Set(['Image', 'HTMLImageElement', 'SVGImageElement', 'SVGUseElement', 'ImageBitmap', 'createImageBitmap', 'drawImage', 'createPattern', 'DOMParser', 'Document', 'CSSStyleSheet', 'eval', 'Function', 'setTimeout', 'setInterval', 'insertAdjacentHTML', 'createContextualFragment', 'setHTML', 'setHTMLUnsafe', 'attachShadow', 'insertRule'])
  const nonReceivers = new Set(['const', 'let', 'var', 'of', 'in', 'return', 'throw', 'case', 'new', 'delete', 'void', 'typeof', 'yield', 'await', 'else', 'do', 'instanceof'])
  const reject = (): never => { throw failure('IMAGE_BINDING_INVALID') }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!, name = token.value
    if (token.kind === 'word' && (forbidden.has(name) || /^__/.test(name) || name === 'constructor')) reject()
    if (value(index - 1) === '.' && ['call', 'apply', 'bind'].includes(name)) reject()
    if (value(index - 1) === '.' && ['push', 'unshift', 'splice', 'fill'].includes(name)) {
      const start = receiverStart(index - 2)
      if (tokens[start]?.kind !== 'word' || !bindingAt(value(start)!, start)) reject()
    }
    if (['document', 'window', 'globalThis'].includes(name)) {
      const allowed = name === 'document' ? ['createElement', 'createElementNS', 'getElementById'] : ['document', 'devicePixelRatio']
      if (value(index + 1) !== '.' || !allowed.includes(value(index + 2) ?? '')) reject()
    }
    if (['createElement', 'createElementNS', 'setAttribute', 'setAttributeNS', 'setProperty'].includes(name) && token.kind === 'word') {
      const args = argsAt(index)
      if (value(index - 1) !== '.' || !args) reject()
      const offset = name.endsWith('NS') ? 1 : 0, key = literal(args![offset] ?? [])?.toLowerCase()
      if (!key) reject()
      if (name.startsWith('createElement')) { if (!tags.has(key!)) reject() }
      else if (name === 'setProperty') { if (!styleProperties.has(key!.replace(/-/g, ''))) reject() }
      else if (!attributes.has(key!) && (!paintAttributes.has(key!) || !paintArgument(args![offset + 1] ?? [], index))) reject()
    }
    if (value(index - 1) === '.' && ['src', 'srcset', 'href', 'srcdoc', 'innerHTML', 'outerHTML', 'cssText', 'ownerDocument', 'defaultView'].includes(name)) reject()
    if (name === 'style' && value(index - 1) === '.') {
      if (value(index + 1) !== '.' || !styleProperties.has((value(index + 2) ?? '').toLowerCase()) && value(index + 2) !== 'setProperty') reject()
    }
    if (['Object', 'Reflect'].includes(name)) {
      const method = value(index + 2), args = argsAt(index + 2)
      if (value(index + 1) !== '.' || !args || name === 'Reflect') reject()
      if (method === 'assign') { if (!(args![0]?.length === 1 && visibleData(args![0][0]?.value ?? '', index)) && args![0]?.map(item => item.value).join('') !== '{}') reject() }
      else if (!['keys', 'values', 'entries', 'fromEntries', 'freeze', 'is', 'hasOwn'].includes(method ?? '')) reject()
    }
    if (name === '[' && (tokens[index - 1]?.kind === 'word' && !nonReceivers.has(value(index - 1) ?? '') || [']', ')'].includes(value(index - 1) ?? ''))) {
      const end = closes.get(index)
      if (end === undefined) reject()
      if (value(end! + 1) === '(') reject()
      const receiver = tokens.slice(receiverStart(index - 1), index)
      if (!safeOrigin(readExpression(receiver, index))) reject()
      if (['constructor', 'prototype', '__proto__'].includes(literal(tokens.slice(index + 1, end)) ?? '')) reject()
      const writes = value(end! + 1) === '=' || ['+', '-', '*', '/', '%', '&', '|', '^'].includes(value(end! + 1) ?? '') && ['=', value(end! + 1)].includes(value(end! + 2) ?? '')
      if (writes) {
        const receiver = value(index - 1)!
        if (!visibleData(receiver, index) || ['.', ']', ')'].includes(value(index - 2) ?? '')) reject()
        palettes.delete(receiver)
      }
    }
  }
}
/** Only a unique module-level `const NAME = 'path';` whose other mentions are
 * direct .src/setAttribute sinks is proven. Any shadow, reassignment or other
 * use invalidates that name globally rather than guessing its lexical binding. */
function constantImageReferences(source: string): string[] {
  const tokens = assetTokens(source)
  if (tokens === undefined) return []
  const mentions = new Map<string, number[]>()
  tokens.forEach((token, index) => { if (token.kind === 'word') { const entries = mentions.get(token.value) ?? []; entries.push(index); mentions.set(token.value, entries) } })
  const value = (index: number): string | undefined => tokens[index]?.value
  const references: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const declaration = tokens[index], name = tokens[index + 1], literal = tokens[index + 3]
    if (declaration?.value !== 'const' || declaration.depth !== 0 || name?.kind !== 'word' || value(index + 2) !== '=' || literal?.kind !== 'string' || literal.value.includes('\\') || value(index + 4) !== ';') continue
    const uses = (mentions.get(name.value) ?? []).filter(at => at !== index + 1)
    const direct = (at: number): boolean => {
      const assignment = value(at - 3) === '.' && value(at - 2) === 'src' && value(at - 1) === '=' &&
        (value(at + 1) === undefined || [';', ',', ')', ']', '}'].includes(value(at + 1) ?? ''))
      const attribute = value(at - 5) === '.' && value(at - 4) === 'setAttribute' && value(at - 3) === '(' &&
        ["'src'", '"src"'].includes(value(at - 2) ?? '') && value(at - 1) === ',' && value(at + 1) === ')'
      return assignment || attribute
    }
    if (uses.length && uses.every(direct)) references.push(literal.value.slice(1, -1))
  }
  return references
}
async function bounded(response: Response, maximum: number, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maximum || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw failure('IMAGE_RESPONSE_INVALID')
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) throw failure('IMAGE_RESPONSE_INVALID')
      chunks.push(next.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  signal.throwIfAborted()
  return Buffer.concat(chunks)
}
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 45 || bytes.length > MAX_IMAGE || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw failure('IMAGE_RESPONSE_INVALID')
  let width = 0, height = 0, depth = 0, color = 0, ended = false, afterData = false, palette = false
  const compressed: Buffer[] = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    if (end > bytes.length || length > MAX_IMAGE) throw failure('IMAGE_RESPONSE_INVALID')
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + length)
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw failure('IMAGE_RESPONSE_INVALID')
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw failure('IMAGE_RESPONSE_INVALID')
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8] ?? 0; color = data[9] ?? 0
      if (width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > 8_388_608 || depth !== 8 || ![0,2,4,6].includes(color) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw failure('IMAGE_RESPONSE_INVALID')
    } else if (type === 'IDAT') {
      if (!width || afterData) throw failure('IMAGE_RESPONSE_INVALID')
      compressed.push(data)
    }
    else if (type === 'IEND') { ended = length === 0 && end === bytes.length; break }
    else if (type === 'PLTE') {
      if (!width || palette || compressed.length || [0, 4].includes(color) || length === 0 || length > 768 || length % 3) throw failure('IMAGE_RESPONSE_INVALID')
      palette = true
    } else {
      if (!/^[A-Za-z]{4}$/.test(type) || type[0] === type[0]?.toUpperCase()) throw failure('IMAGE_RESPONSE_INVALID')
      if (compressed.length) afterData = true
    }
    offset = end
  }
  if (!ended || !compressed.length || !width) throw failure('IMAGE_RESPONSE_INVALID')
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : 1
  const expected = height * (width * channels + 1)
  try {
    const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected })
    if (pixels.length !== expected) throw failure('IMAGE_RESPONSE_INVALID')
    for (let row = 0; row < height; row++) if ((pixels[row * (width * channels + 1)] ?? 255) > 4) throw failure('IMAGE_RESPONSE_INVALID')
  }
  catch { throw failure('IMAGE_RESPONSE_INVALID') }
  return { width, height }
}
export class QuestionCodeAssets {
  private readonly jobs = new Map<string, AssetJob>()
  private readonly env: NodeJS.ProcessEnv
  private readonly fetcher: typeof fetch
  constructor(options: Options = {}) { this.env = options.env ?? process.env; this.fetcher = options.fetchImpl ?? fetch }
  private prune(): void { for (const [key, job] of this.jobs) if (job.expires < Date.now()) this.jobs.delete(key) }
  private job(binding: AssetBinding, create = false): AssetJob | undefined {
    this.prune()
    if (!binding.generationId || binding.generationId.length > 200 || !binding.ownerKey || !binding.ownerSessionId || !/^[a-f0-9]{64}$/.test(binding.sceneSha256)) throw failure('IMAGE_BINDING_INVALID')
    const prior = this.jobs.get(binding.generationId)
    if (prior && !sameBinding(prior.binding, binding)) throw failure('IMAGE_BINDING_INVALID')
    if (prior || !create) return prior
    if (this.jobs.size >= 64) throw failure('IMAGE_CAPACITY')
    const job = { binding: { ...binding }, expires: Date.now() + 20 * 60_000, attempts: 0, assets: [] }
    this.jobs.set(binding.generationId, job)
    return job
  }
  manifest(binding: AssetBinding): QuestionAssetDescriptor[] {
    return (this.job(binding)?.assets ?? []).map(asset => ({ ...asset.descriptor }))
  }
  /** Only this host's observed transient failure grants native-only completion. */
  nativeFallback(binding: AssetBinding): QuestionAssetFallback | undefined {
    const job = this.job(binding)
    return job?.fallbackCode && !job.assets.length
      ? { status: 'unavailable', mode: 'native', code: job.fallbackCode } : undefined
  }
  files(binding: AssetBinding, source: string, stylesheet = ''): Map<string, Buffer> {
    const job = this.job(binding), available = job?.assets ?? []
    const masked = source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, value => ' '.repeat(value.length))
    const references = new Set([...cssReferences(stylesheet.replace(/\/\*[\s\S]*?\*\//g, '')), ...constantImageReferences(source)])
    for (const match of source.matchAll(/\.src\s*=\s*(["'])([^"']+)\1/g)) {
      if (masked.slice(match.index, match.index + 4) === '.src') references.add(match[2] ?? '')
    }
    for (const match of source.matchAll(/\.setAttribute\s*\(\s*(["'])src\1\s*,\s*(["'])([^"']+)\2\s*\)/g)) {
      if (masked.slice(match.index, match.index + 13) === '.setAttribute') references.add(match[3] ?? '')
    }
    if (!available.length && job?.fallbackCode) {
      if ([...references].some(reference => !reference.startsWith('#'))) throw failure('IMAGE_BINDING_INVALID')
      validateNativeAssets(source)
    }
    const selected = available.filter(asset => references.has(asset.descriptor.path) || references.has(asset.descriptor.cssPath))
    for (const match of (source + '\n' + stylesheet).matchAll(/(?:\.\/)?(?:assets\/)?generated\/[a-f0-9]+\.png/g)) {
      if (!available.some(asset => asset.descriptor.path.endsWith(match[0].replace(/^\.\//, '')))) throw failure('IMAGE_BINDING_INVALID')
    }
    if (available.length && !selected.length) throw failure('IMAGE_UNUSED')
    const files = new Map<string, Buffer>()
    for (const asset of selected) {
      const name = asset.descriptor.path.slice(2)
      files.set('public/' + name, asset.bytes); files.set('dist/' + name, asset.bytes)
    }
    if (selected.length) {
      const provenance = Buffer.from(JSON.stringify(selected.map(asset => ({ ...asset.descriptor, prompt: asset.prompt, source: 'PhysicsOS runtime image model', usage: 'Appearance only; physics remains engine-owned' })), null, 2))
      files.set('public/assets/generated/provenance.json', provenance)
      files.set('dist/assets/generated/provenance.json', provenance)
    }
    return files
  }
  async generate(input: GenerateQuestionAssetInput): Promise<QuestionAssetDescriptor> {
    const isAborted = (): boolean => input.signal.aborted
    if (isAborted()) throw failure('IMAGE_ABORTED')
    if (!['environment', 'material'].includes(input.kind) || !input.prompt.trim() || input.prompt.length > 5000) throw failure('IMAGE_INPUT_INVALID')
    const job = this.job(input, true)
    if (!job) throw failure('IMAGE_BINDING_INVALID')
    if (job.attempts >= 2) throw failure('IMAGE_LIMIT')
    job.attempts++
    const controller = new AbortController(), onAbort = (): void => { controller.abort() }
    let timedOut = false, transientCode: QuestionAssetFallback['code'] | undefined
    const upstreamFailure = (status: number): Error => {
      if (status === 429) transientCode = 'IMAGE_RATE_LIMIT'
      else if (status >= 500 && status <= 599) transientCode = 'IMAGE_SERVICE_UNAVAILABLE'
      return failure('IMAGE_GENERATION_FAILED')
    }
    input.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 180_000)
    try {
      const env = this.env
      const keyFile = env.PHYSICSOS_IMAGE_API_KEY_FILE ?? env.PHYSICOS_IMAGE_API_KEY_FILE ?? '/run/secrets/image_api_key'
      const key = (env.PHYSICSOS_IMAGE_API_KEY ?? env.PHYSICOS_IMAGE_API_KEY ?? await readFile(keyFile, 'utf8').catch(() => '')).trim()
      if (!key || /placeholder|set-later/i.test(key)) throw failure('IMAGE_NOT_CONFIGURED')
      const base = new URL(env.PHYSICSOS_IMAGE_API_BASE ?? env.PHYSICOS_IMAGE_API_BASE ?? 'https://image.haqiuhaqiu.xyz')
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw failure('IMAGE_NOT_CONFIGURED')
      const model = env.PHYSICSOS_IMAGE_API_MODEL ?? env.PHYSICOS_IMAGE_API_MODEL ?? 'gpt-image-2.5-sunburst'
      const endpoint = base.href.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/images/generations'
      const prompt = 'PhysicsOS Warm Lab runtime appearance asset. Natural materials, soft daylight, credible physical laboratory. No text, numbers, formulas, arrows, trajectories, graphs, watermarks or baked-in moving objects. Leave clear space for engine-driven apparatus.\n' + input.prompt
      const response = await this.fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model, prompt, n: 1, size: input.kind === 'environment' ? '1536x1024' : '1024x1024', response_format: 'b64_json' }), redirect: 'error', signal: controller.signal })
      if (!response.ok) { const error = upstreamFailure(response.status); await response.body?.cancel().catch(() => undefined); throw error }
      const parsed: unknown = JSON.parse((await bounded(response, MAX_BODY, controller.signal)).toString('utf8'))
      const item = typeof parsed === 'object' && parsed !== null && 'data' in parsed && Array.isArray(parsed.data) ? parsed.data[0] as unknown : undefined
      if (typeof item !== 'object' || item === null) throw failure('IMAGE_RESPONSE_INVALID')
      let bytes: Buffer
      if ('b64_json' in item && typeof item.b64_json === 'string' && item.b64_json.length > 0) {
        if (item.b64_json.length > MAX_IMAGE * 1.4 || !/^[A-Za-z0-9+/=\r\n]+$/.test(item.b64_json)) throw failure('IMAGE_RESPONSE_INVALID')
        bytes = Buffer.from(item.b64_json, 'base64')
      } else if ('url' in item && typeof item.url === 'string') {
        const url = new URL(item.url)
        if (url.origin !== base.origin || url.protocol !== 'https:' || url.username || url.password || url.hash) throw failure('IMAGE_RESPONSE_INVALID')
        const download = await this.fetcher(url, { signal: controller.signal, redirect: 'error' })
        if (!download.ok) { const error = upstreamFailure(download.status); await download.body?.cancel().catch(() => undefined); throw error }
        bytes = await bounded(download, MAX_IMAGE, controller.signal)
      } else throw failure('IMAGE_RESPONSE_INVALID')
      controller.signal.throwIfAborted()
      const dimensions = pngSize(bytes)
      const resident = [...this.jobs.values()].flatMap(value => value.assets).reduce((sum, asset) => sum + asset.bytes.length, 0)
      if (resident + bytes.length > MAX_MEMORY) throw failure('IMAGE_CAPACITY')
      const id = randomBytes(16).toString('hex'), descriptor: QuestionAssetDescriptor = { path: './assets/generated/' + id + '.png', cssPath: './generated/' + id + '.png', sha256: digest(bytes), ...dimensions, kind: input.kind, model }
      job.assets.push({ descriptor, bytes, prompt })
      return { ...descriptor }
    } catch (error) {
      if (isAborted()) throw failure('IMAGE_ABORTED')
      // Never infer permission from provider/user diagnostic strings.
      if (timedOut) { job.fallbackCode = 'IMAGE_TIMEOUT'; throw failure('IMAGE_TIMEOUT') }
      if (transientCode !== undefined) job.fallbackCode = transientCode
      if (error instanceof Error && /^IMAGE_[A-Z_]+$/.test(error.message)) throw error
      throw failure('IMAGE_GENERATION_FAILED')
    } finally { clearTimeout(timer); input.signal.removeEventListener('abort', onAbort); controller.abort() }
  }
}
