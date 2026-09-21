import type { KnownValue } from './semantic-ir.ts'
import type { QuestionSolutionStep } from './question-solution.ts'

/**
 * Exam-format substitution lines.
 *
 * The answer standard for 中考/高考 计算题 is 公式 → 代入数据 → 结果. Solution
 * steps already carry the formula (`title`/`formula`) and the result; this file
 * fills the middle row by replacing every symbol on the formula's right-hand
 * side with the value the student stated — `v = v0 + at` becomes
 * `v = 10 m/s + (2 m/s²) × (5 s)`.
 *
 * The pass is deliberately conservative: it only emits a line when every
 * identifier on the right-hand side resolves to a stated known. A half-filled
 * expression (`v = v0 + 2 m/s² × t`) would teach wrong algebra, so a step whose
 * symbols the IR does not fully cover simply shows formula → result, exactly as
 * before.
 */

/* Greek and subscript characters that can appear inside a physics identifier:
   `r₂`, `θ`, `λ`, `Φ`. Function words stay literal — they are notation, not
   quantities. */
const GREEK = 'λπΔθμωΦρσεαβγφτν'
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉'
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'log'])

type Token =
  | { readonly kind: 'ident'; readonly text: string }
  | { readonly kind: 'op'; readonly text: string }
  | { readonly kind: 'num'; readonly text: string }

const isIdentChar = (char: string): boolean =>
  /[A-Za-z0-9_]/.test(char) || GREEK.includes(char) || SUBSCRIPTS.includes(char)

/** Split a right-hand side into identifiers, numbers and operators. */
function tokenize(rhs: string): readonly Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < rhs.length) {
    const char = rhs[index] ?? ''
    if (char === ' ' || char === ' ') {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      let end = index + 1
      while (end < rhs.length && /[0-9.]/.test(rhs[end] ?? '')) end += 1
      tokens.push({ kind: 'num', text: rhs.slice(index, end) })
      index = end
      continue
    }
    if (isIdentChar(char)) {
      let end = index + 1
      while (end < rhs.length && isIdentChar(rhs[end] ?? '')) end += 1
      tokens.push({ kind: 'ident', text: rhs.slice(index, end) })
      index = end
      continue
    }
    if ('+-*·×/()|√²³−'.includes(char)) {
      tokens.push({ kind: 'op', text: char })
      index += 1
      continue
    }
    /* Anything else — CJK, punctuation, comparison words — means the title is
       prose, not an equation. */
    return null
  }
  return tokens
}

/**
 * Resolve one identifier run to its factor list, or null.
 *
 * Runs without digits/subscripts may split char-by-char (`qvB` → `q·v·B`);
 * anything containing a digit or subscript (`v0`, `r₂`) is atomic — splitting
 * `v0` into `v` + `0` would silently write the wrong physics, so an unmatched
 * composite run just fails.
 */
/** Notation constants that pass through unchanged — `π`, never a known. */
const LITERALS = new Set(['π', 'e'])

interface Factor {
  readonly text: string
  readonly known: boolean
}

function resolveRun(run: string, knowns: ReadonlyMap<string, string>): readonly Factor[] | null {
  const exact = knowns.get(run)
  if (exact !== undefined) return [{ text: exact, known: true }]
  if (FUNCTIONS.has(run)) return []
  if (LITERALS.has(run)) return [{ text: run, known: false }]
  if (/[0-9_]/.test(run) || [...run].some(c => SUBSCRIPTS.includes(c))) return null
  const chars = [...run]
  if (chars.length < 2) return null
  const parts: Factor[] = []
  for (const char of chars) {
    const hit = knowns.get(char)
    if (hit === undefined) {
      if (LITERALS.has(char)) parts.push({ text: char, known: false })
      else return null
    } else parts.push({ text: hit, known: true })
  }
  return parts
}

/**
 * Render one step's substitution line, or undefined when the step is not a
 * clean equation or some right-hand symbol is not a stated known.
 */
export function substitutionFor(step: QuestionSolutionStep, knowns: readonly KnownValue[]): string | undefined {
  const expression = step.formula?.expression ?? (/[=√]/.test(step.title) ? step.title : null)
  if (expression === null) return undefined
  const eqIndex = expression.indexOf('=')
  if (eqIndex <= 0 || expression.indexOf('=', eqIndex + 1) !== -1) return undefined
  const lhs = expression.slice(0, eqIndex).trim()
  const rhs = expression.slice(eqIndex + 1)
  const tokens = tokenize(rhs)
  if (tokens === null || tokens.length === 0) return undefined

  /* `displayValue` already carries the unit (`10 m/s`, `1.67×10⁻²⁷ kg`); the
     value+unit pair is only a fallback. `^` exponents in raw unit strings
     (`m/s^2`) normalize to superscripts for print. */
  const superscripts: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  const pretty = (text: string): string =>
    text.replace(/\^(\(?)(-?\d+)(\)?)/g, (_, _open, digits: string) =>
      [...digits].map(c => superscripts[c] ?? c).join(''))

  const knownsMap = new Map<string, string>()
  for (const known of knowns) {
    const text = known.displayValue ?? `${known.value}${known.unit === '' ? '' : ` ${known.unit}`}`
    knownsMap.set(known.symbol, pretty(text))
  }

  const rendered: string[] = []
  let substituted = 0
  for (const token of tokens) {
    if (token.kind !== 'ident') {
      rendered.push(token.text)
      continue
    }
    /* Function prefix inside the run: `sinθ` → `sin(θ)` when θ is stated. */
    const fn = [...FUNCTIONS].find(name => token.text.startsWith(name) && token.text.length > name.length)
    const core = fn === undefined ? token.text : token.text.slice(fn.length)
    const factors = resolveRun(core, knownsMap)
    if (factors === null) return undefined
    if (factors.length === 0) {
      /* A bare function word like `sin` — only legal through the prefix path. */
      if (fn !== undefined) return undefined
      rendered.push(token.text)
      continue
    }
    substituted += factors.filter(f => f.known).length
    const join = factors.map(f => (f.known ? `(${f.text})` : f.text)).join('×')
    rendered.push(fn === undefined ? join : `${fn}(${factors.map(f => f.text).join('×')})`)
  }
  if (substituted === 0) return undefined

  /* Insert explicit × between adjacent factors — the exam format writes the
     operator instead of relying on juxtaposition. `|` bars alternate
     open/close: only a closing bar can sit between two multiplied terms. */
  const out: string[] = []
  let bars = 0
  for (const part of rendered) {
    const prev = out[out.length - 1]
    const prevCloses = prev !== undefined && (/[0-9²³)]$/.test(prev) || (prev === '|' && bars % 2 === 0))
    const partOpensFactor = /^[0-9(]/.test(part) || GREEK.includes(part[0] ?? '') || FUNCTIONS.has(part)
    if (prevCloses && partOpensFactor) out.push('×')
    out.push(part)
    if (part === '|') bars += 1
  }
  return `${lhs} = ${out.join(' ')}`
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\|\s+/g, '|')
    .replace(/\s+\|/g, '|')
    .replace(/\s+([²³])/g, '$1')
    .replace(/\*/g, '×')
    .replace(/\s*([×·−])\s*/g, ' $1 ')
    .replace(/\)\s*\/\s*/g, ') / ')
    .replace(/\s*\/\s*(?=[|(])/g, ' / ')
    .replace(/=\s*/, '= ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Attach substitution lines to every step of a built solution, in place.
 * Called once per solve so every domain's narrative gets the 代入 row without
 * each builder hand-writing it.
 */
export function attachSubstitutions(steps: QuestionSolutionStep[], knowns: readonly KnownValue[]): void {
  for (const step of steps) {
    const substitution = substitutionFor(step, knowns)
    if (substitution !== undefined) step.substitution = substitution
  }
}
