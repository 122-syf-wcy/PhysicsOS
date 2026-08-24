/**
 * Inline math for HTML surfaces (inspector rows, derivation steps, solution
 * text). The canvas equivalent is `MathLabel` in primitives.tsx; both share
 * {@link parseMathSymbol} so a symbol reads identically in a panel and on the
 * canvas.
 */

import { parseMathSymbol } from './math-symbol.ts'
import css from './MathText.module.css'

export function MathText({ expression }: { readonly expression: string }) {
  const parts = parseMathSymbol(expression)
  return (
    <span className={css.math}>
      {parts.map((part, index) =>
        part.script === 'sub' ? (
          <sub key={index}>{part.text}</sub>
        ) : part.script === 'super' ? (
          <sup key={index}>{part.text}</sup>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  )
}
