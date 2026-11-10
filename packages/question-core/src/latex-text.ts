/**
 * One place that turns a drafted stem into the plain text every parser reads.
 *
 * Drafted papers write their physics in LaTeX: `$m = 2.0\ \mathrm{kg}$`,
 * `$\theta = 37^\circ$`, `$v_0 = 6\ \mathrm{m/s}$`. Each parser's patterns were
 * written against plain text ("m = 2.0 kg"), so on a real paper the same
 * question that parsed correctly in a hand-written test lost its incline angle
 * and friction coefficient — or matched a different model altogether.
 *
 * Normalising here rather than inside each parser keeps the ten of them
 * consistent: a pattern written once works on both shapes, and a parser added
 * later inherits the behaviour without knowing LaTeX exists.
 *
 * This rewrites text only. It never guesses a value, drops a condition, or
 * moves a number between clauses — a parser that finds a quantity afterwards
 * found it in the stem.
 * @module @physicsos/question-core/latex-text
 */

/** Commands whose single argument is literal text. */
const TEXT_COMMANDS = /\\(?:mathrm|text|textrm|textnormal|mathit|mathbf|rm|bf|it|operatorname)\s*\{([^{}]*)\}/g

/** Commands that are a symbol rather than text; replaced by their character. */
const SYMBOL_COMMANDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\\theta\b/g, 'θ'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\gamma\b/g, 'γ'],
  [/\\mu\b/g, 'μ'],
  [/\\lambda\b/g, 'λ'],
  [/\\omega\b/g, 'ω'],
  [/\\Delta\b/g, 'Δ'],
  [/\\delta\b/g, 'δ'],
  [/\\pi\b/g, 'π'],
  [/\\rho\b/g, 'ρ'],
  [/\\sigma\b/g, 'σ'],
  [/\\tau\b/g, 'τ'],
  [/\\varphi\b/g, 'φ'],
  [/\\phi\b/g, 'φ'],
  [/\\eta\b/g, 'η'],
]

/**
 * Reduce a stem's LaTeX to plain text.
 *
 * The order is load-bearing: fragments are unwrapped before delimiters are
 * removed (so `$...$` boundaries stay visible while unwrapping), `\circ`
 * becomes a degree sign before the generic backslash cleanup, and fraction
 * commands are expanded before their braces are stripped.
 * @param text - the stem as drafted, with or without LaTeX.
 * @returns the same stem in plain text; already-plain input is unchanged.
 */
export function normalizeStemText(text: string): string {
  let out = text

  /* \dfrac{a}{b} and \frac{a}{b} → (a)/(b), before braces disappear. */
  out = out.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')

  /* Degrees: 37^\circ, 37^{\circ}, 37^{\circ} → 37° */
  out = out.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')

  /* Superscripts that carry a unit's exponent: \mathrm{m/s^2} keeps its ^2
     because the unit patterns expect m/s^2; only a bare ^{...} around digits
     is flattened. */
  out = out.replace(/\^\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/g, '^$1')

  /* Subscripts: m_{1} and m_1 both become m_1 — one spelling for the parsers,
     which write their suffixes against the underscore form. */
  out = out.replace(/\s*_\s*\{\s*([^{}]*?)\s*\}/g, '_$1')
  out = out.replace(/\s*_\s*([A-Za-z0-9])/g, '_$1')

  /* Text-bearing commands: unwrap repeatedly, since they nest. */
  for (let i = 0; i < 3 && TEXT_COMMANDS.test(out); i += 1) {
    TEXT_COMMANDS.lastIndex = 0
    out = out.replace(TEXT_COMMANDS, '$1')
  }

  for (const [pattern, symbol] of SYMBOL_COMMANDS) out = out.replace(pattern, symbol)

  /* Spacing commands: \  \, \; \! \quad \qquad */
  out = out.replace(/\\quad\b/g, ' ').replace(/\\qquad\b/g, ' ')
  out = out.replace(/\\[,;:!]/g, ' ')
  out = out.replace(/\\\s/g, ' ')

  /* Math delimiters last: $$ … $$ then $ … $. */
  out = out.replace(/\$\$/g, '').replace(/\$/g, '')

  /* Leftover spacing artefacts from the stripping. */
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Split a stem into the clause that sets the question up and the clause that
 * asks it.
 *
 * The division matters because a givens list mentions 速度 and 加速度
 * constantly while only the ask says which one the student must produce. The
 * position is returned so a caller can report findings against the original.
 * @param text - a stem, before or after {@link normalizeStemText}.
 * @returns the setup and the ask; `ask` is the whole text when no marker exists.
 */
export function splitStemIntent(text: string): { readonly setup: string; readonly ask: string; readonly askIndex: number } {
  const match = /(?:求|计算|试求|则|下列说法|问)[^。]{0,120}/.exec(text)
  if (match?.index === undefined) return { setup: text, ask: text, askIndex: 0 }
  return { setup: text.slice(0, match.index), ask: match[0], askIndex: match.index }
}
