/**
 * Light TeX subset for physics symbols.
 *
 * Physics labels are short and structural — `v_x`, `v_0`, `mg\sin\theta`,
 * `F_{net}` — so a full TeX engine is overkill, but flattening them to `vx` is
 * wrong typography. This splits a symbol into runs with an optional script level;
 * an SVG renderer turns those into `<tspan>` baseline shifts and an HTML renderer
 * into `<sub>` / `<sup>`.
 */

export interface MathPart {
  text: string
  script?: 'sub' | 'super'
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

/** Split a light TeX subset into runs with optional script level. */
export const parseMathSymbol = (input: string): readonly MathPart[] => {
  const expanded = input
    .replace(/\\(theta|mu|alpha|beta|omega|Delta|Sigma|pi)\b/g, (_, name: string) => GREEK[name] ?? name)
    .replace(/\\sin/g, 'sin')
    .replace(/\\cos/g, 'cos')
    .replace(/\\tan/g, 'tan')
    .replace(/\\tfrac/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')

  const parts: MathPart[] = []
  let buffer = ''
  let index = 0
  while (index < expanded.length) {
    const char = expanded[index]
    if (char === '_' || char === '^') {
      if (buffer.length > 0) {
        parts.push({ text: buffer })
        buffer = ''
      }
      index += 1
      let script = ''
      if (expanded[index] === '{') {
        index += 1
        while (index < expanded.length && expanded[index] !== '}') {
          script += expanded[index] ?? ''
          index += 1
        }
        index += 1
      } else if (index < expanded.length) {
        script += expanded[index] ?? ''
        index += 1
      }
      if (script.length > 0) parts.push({ text: script, script: char === '_' ? 'sub' : 'super' })
      continue
    }
    /* Braces outside a script group carry no meaning at this scale. */
    if (char !== undefined && char !== '{' && char !== '}') buffer += char
    index += 1
  }
  if (buffer.length > 0) parts.push({ text: buffer })
  return parts
}
