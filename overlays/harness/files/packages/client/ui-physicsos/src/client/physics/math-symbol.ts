/**
 * Light TeX subset for physics symbols.
 *
 * Physics labels are short and structural — `v_x`, `v_0`, `mg\sin\theta`,
 * `F_{net}` — so a full TeX engine is overkill, but flattening them to `vx` is
 * wrong typography. This splits a symbol into runs with an optional script
 * level; an SVG renderer turns those into `<tspan>` baseline shifts and an
 * HTML renderer into `<sub>` / `<sup>`.
 *
 * Structural groups — `\frac{a}{b}` (also `\tfrac`, `\dfrac`, and the unbraced
 * `\tfrac12` form), `\sqrt{x}` / `\sqrt[n]{x}`, and `\text{...}` — parse into
 * nested part lists. An HTML renderer stacks the fraction and overlines the
 * radical; the flattened {@link MathPart.text} (`(a)/(b)`, `√(x)`) keeps SVG
 * labels and width estimates readable with no renderer changes.
 */

export interface MathPart {
  /** Flattened text; for structural parts this is the `(a)/(b)` / `√(x)` form. */
  text: string
  script?: 'sub' | 'super'
  /** Stacked fraction; renderers that understand it ignore `text`. */
  frac?: { readonly num: readonly MathPart[]; readonly den: readonly MathPart[] }
  /** Radical with an optional root index (`\sqrt[3]{x}`). */
  sqrt?: { readonly body: readonly MathPart[]; readonly index?: readonly MathPart[] }
}

const GREEK: Record<string, string> = {
  theta: 'θ',
  mu: 'μ',
  alpha: 'α',
  beta: 'β',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  pi: 'π',
}

/** Read one TeX group: a balanced `{...}` or a single token (`\cmd` or char). */
const readGroup = (src: string, at: number): { content: string; next: number } => {
  if (src[at] === '{') {
    let depth = 1
    let cursor = at + 1
    while (cursor < src.length && depth > 0) {
      if (src[cursor] === '{') depth += 1
      else if (src[cursor] === '}') depth -= 1
      if (depth === 0) break
      cursor += 1
    }
    return { content: src.slice(at + 1, cursor), next: Math.min(cursor + 1, src.length) }
  }
  const command = /^\\[a-zA-Z]+/.exec(src.slice(at))
  if (command !== null) return { content: command[0], next: at + command[0].length }
  return { content: src.slice(at, at + 1), next: at + 1 }
}

/** Plain-text rendering of a part list — the fallback baked into `text`. */
const flattenParts = (parts: readonly MathPart[]): string =>
  parts
    .map((part) => {
      if (part.frac !== undefined) {
        return `(${flattenParts(part.frac.num)})/(${flattenParts(part.frac.den)})`
      }
      if (part.sqrt !== undefined) return `√(${flattenParts(part.sqrt.body)})`
      return part.text
    })
    .join('')

const fracPart = (num: readonly MathPart[], den: readonly MathPart[]): MathPart => ({
  text: `(${flattenParts(num)})/(${flattenParts(den)})`,
  frac: { num, den },
})

const sqrtPart = (body: readonly MathPart[], index: readonly MathPart[] | undefined): MathPart => ({
  text: `${index === undefined ? '' : flattenParts(index)}√(${flattenParts(body)})`,
  sqrt: index === undefined ? { body } : { body, index },
})

const parseParts = (src: string): MathPart[] => {
  const parts: MathPart[] = []
  let buffer = ''
  let index = 0
  const flush = (): void => {
    if (buffer.length > 0) {
      parts.push({ text: buffer })
      buffer = ''
    }
  }
  while (index < src.length) {
    const char = src[index]
    if (char === '\\') {
      const command = /^\\[a-zA-Z]+/.exec(src.slice(index))?.[0]
      if (command === '\\frac' || command === '\\tfrac' || command === '\\dfrac') {
        flush()
        const num = readGroup(src, index + command.length)
        const den = readGroup(src, num.next)
        parts.push(fracPart(parseParts(num.content), parseParts(den.content)))
        index = den.next
        continue
      }
      if (command === '\\sqrt') {
        flush()
        let cursor = index + command.length
        let rootIndex: readonly MathPart[] | undefined
        if (src[cursor] === '[') {
          const close = src.indexOf(']', cursor)
          if (close > cursor) {
            rootIndex = parseParts(src.slice(cursor + 1, close))
            cursor = close + 1
          }
        }
        const body = readGroup(src, cursor)
        parts.push(sqrtPart(parseParts(body.content), rootIndex))
        index = body.next
        continue
      }
      if (command === '\\text' || command === '\\mathrm' || command === '\\mathbf' || command === '\\operatorname') {
        const group = readGroup(src, index + command.length)
        buffer += group.content
        index = group.next
        continue
      }
      /* Unknown commands stay literal, as they always have. */
      buffer += char
      index += 1
      continue
    }
    if (char === '_' || char === '^') {
      flush()
      index += 1
      let script = ''
      if (src[index] === '{') {
        const group = readGroup(src, index)
        script = group.content
        index = group.next
      } else if (index < src.length) {
        script += src[index] ?? ''
        index += 1
      }
      const scriptParts = parseParts(script)
      if (scriptParts.length > 0) {
        const level = char === '_' ? ('sub' as const) : ('super' as const)
        parts.push(...scriptParts.map(part => ({ ...part, script: level })))
      }
      continue
    }
    /* Braces outside a script group carry no meaning at this scale. */
    if (char !== undefined && char !== '{' && char !== '}') buffer += char
    index += 1
  }
  flush()
  return parts
}

/** Split a light TeX subset into runs with optional script level. */
export const parseMathSymbol = (input: string): readonly MathPart[] => {
  const expanded = input
    .replace(/\\(theta|mu|alpha|beta|omega|Delta|Sigma|pi)\b/g, (_, name: string) => GREEK[name] ?? name)
    .replace(/\\sin/g, 'sin')
    .replace(/\\cos/g, 'cos')
    .replace(/\\tan/g, 'tan')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
  return parseParts(expanded)
}

/* ------------------------------------------------------------ toTex ------ */

/* Engine `formula.expression` strings are authored in a readable Unicode
   dialect (`K = ½mᵢvᵢ²`, `d = x_壁 − x_源`, `P = Σpᵢ`) while view builders
   write TeX (`\tfrac`, `\Sigma`). KaTeX only speaks TeX, so the Unicode
   dialect is normalised here — one pass over the string, recursing into
   radical bodies. Already-TeX input passes through untouched. */

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6',
  '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(',
  '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k',
  'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's',
  'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
}

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6',
  '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(',
  '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
}

const VULGAR_FRACTIONS: Record<string, readonly [number, number]> = {
  '½': [1, 2], '⅓': [1, 3], '¼': [1, 4], '⅔': [2, 3], '¾': [3, 4],
  '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5], '⅘': [4, 5], '⅙': [1, 6],
  '⅚': [5, 6], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
}

const TEX_SYMBOLS: Record<string, string> = {
  '−': '-', '·': '\\cdot', '×': '\\times', '÷': '\\div', '±': '\\pm',
  '∞': '\\infty', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq',
  '≈': '\\approx', '∝': '\\propto', '→': '\\to', '∫': '\\int',
  'ℓ': '\\ell', '′': "'", '″': "''", '（': '(', '）': ')', '：': ':',
  '％': '\\%', '°': '^{\\circ}',
}

const GREEK_TEX: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'ε': '\\varepsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
  'λ': '\\lambda', 'μ': '\\mu', 'π': '\\pi', 'ρ': '\\rho',
  'σ': '\\sigma', 'τ': '\\tau', 'φ': '\\varphi', 'ω': '\\omega',
  'Δ': '\\Delta', 'Σ': '\\Sigma', 'Ω': '\\Omega', 'Φ': '\\Phi',
  'Λ': '\\Lambda', 'Π': '\\Pi', 'Θ': '\\Theta', 'Ξ': '\\Xi',
  'Ψ': '\\Psi',
}

const isCjk = (char: string): boolean => /[㐀-鿿豈-﫿]/.test(char)

/** Find the offset just past the `)` balancing the `(` at `open`. */
const parenEnd = (src: string, open: number): number => {
  let depth = 0
  for (let cursor = open; cursor < src.length; cursor += 1) {
    if (src[cursor] === '(') depth += 1
    else if (src[cursor] === ')') {
      depth -= 1
      if (depth === 0) return cursor + 1
    }
  }
  return src.length
}

/** The radicand after `√`: a `(...)` group, a `{...}` group, or a token run. */
const radicand = (src: string, at: number): { body: string; next: number } => {
  if (src[at] === '(') {
    const next = parenEnd(src, at)
    return { body: src.slice(at + 1, next - 1), next }
  }
  if (src[at] === '{') {
    const group = readGroup(src, at)
    return { body: group.content, next: group.next }
  }
  const token = /^[0-9a-zA-Z_.]+/.exec(src.slice(at))?.[0] ?? src.slice(at, at + 1)
  return { body: token, next: at + token.length }
}

/**
 * Normalise a physics expression into KaTeX-ready TeX: Unicode scripts become
 * `_{}`/`^{}` groups, vulgar fractions become `\tfrac`, `√` gains a braced
 * radicand, CJK runs are wrapped in `\text`, and long Latin word runs
 * (`constant`, `inside`, `enter`) become `\mathrm` so they do not render as a
 * row of italic variables. TeX commands already in the string pass through.
 */
export const toTexExpression = (input: string): string => {
  const src = input.replace(/([A-Za-zΑ-Ωα-ω])̂/g, '\\hat{$1}')
  let out = ''
  let index = 0
  while (index < src.length) {
    const char = src[index] as string
    if (char === '\\') {
      const command = /^\\[a-zA-Z]+|^\\./.exec(src.slice(index))?.[0] ?? char
      out += command
      index += command.length
      continue
    }
    if (isCjk(char)) {
      const run = /^[㐀-鿿豈-﫿]+/.exec(src.slice(index))?.[0] ?? char
      out += `\\text{${run}}`
      index += run.length
      continue
    }
    if (char === '√') {
      const { body, next } = radicand(src, index + 1)
      out += `\\sqrt{${toTexExpression(body)}}`
      index = next
      continue
    }
    const sub = SUBSCRIPTS[char]
    if (sub !== undefined) {
      let run = sub
      index += 1
      let nextSub = SUBSCRIPTS[src[index] as string]
      while (nextSub !== undefined) {
        run += nextSub
        index += 1
        nextSub = SUBSCRIPTS[src[index] as string]
      }
      out += `_{${run}}`
      continue
    }
    const sup = SUPERSCRIPTS[char]
    if (sup !== undefined) {
      let run = sup
      index += 1
      let nextSup = SUPERSCRIPTS[src[index] as string]
      while (nextSup !== undefined) {
        run += nextSup
        index += 1
        nextSup = SUPERSCRIPTS[src[index] as string]
      }
      out += `^{${run}}`
      continue
    }
    const fraction = VULGAR_FRACTIONS[char]
    if (fraction !== undefined) {
      out += `\\tfrac{${fraction[0]}}{${fraction[1]}}`
      index += 1
      continue
    }
    /* TeX command names run to the first non-letter, so a `\theta`-class
       command followed directly by a letter needs a separator (`\thetax`
       would not parse). */
    const emitCommand = (command: string, at: number): void => {
      out += command
      index = at
      if (/[A-Za-z]$/.test(command) && /[A-Za-z]/.test(src[index] ?? '')) out += ' '
    }
    const greek = GREEK_TEX[char]
    if (greek !== undefined) {
      emitCommand(greek, index + 1)
      continue
    }
    const symbol = TEX_SYMBOLS[char]
    if (symbol !== undefined) {
      emitCommand(symbol, index + 1)
      continue
    }
    if (char === '%' || char === '#' || char === '&' || char === '$') {
      out += `\\${char}`
      index += 1
      continue
    }
    if (/[A-Za-z]/.test(char)) {
      const run = /^[A-Za-z]+/.exec(src.slice(index))?.[0] ?? char
      /* A word run (≥4 letters) that does not trail a letter or digit is
         prose inside the formula — `= constant`, `Δr_inside`, `t_enter` —
         and reads as upright text, not italic variables. */
      const previous = index > 0 ? (src[index - 1] as string) : ''
      out += run.length >= 4 && !/[A-Za-z0-9]/.test(previous) ? `\\mathrm{${run}}` : run
      index += run.length
      continue
    }
    out += char
    index += 1
  }
  return out
}
