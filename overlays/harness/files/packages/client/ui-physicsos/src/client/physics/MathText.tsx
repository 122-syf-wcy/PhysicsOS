/**
 * Inline math for HTML surfaces (inspector rows, derivation steps, solution
 * text). Expressions are authored in two dialects — TeX (`\tfrac`, `\Sigma`)
 * and the engines' Unicode shorthand (`K = ½mᵢvᵢ²`) — {@link toTexExpression}
 * normalises both to TeX and KaTeX does the typesetting. The canvas
 * equivalent is `MathLabel` in primitives.tsx, which keeps the lighter
 * `parseMathSymbol` because SVG labels never carry fractions or radicals.
 */

import { renderTexToReact } from '@deepseek-ai/dsh-client-ui-primitives'
import { toTexExpression } from './math-symbol.ts'
import css from './MathText.module.css'

/* KaTeX's stylesheet cannot ride the client bundle — only *.module.css is
   compiled there — so it is served as a static asset and linked once, the
   same way the bundle injects module styles. The fonts it @font-faces sit
   next to it under /physicsos/katex/. */
const KATEX_CSS_HREF = '/physicsos/katex/katex.min.css'
if (
  typeof document !== 'undefined' &&
  document.querySelector(`link[href="${KATEX_CSS_HREF}"]`) === null
) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = KATEX_CSS_HREF
  document.head.appendChild(link)
}

export function MathText({ expression }: { readonly expression: string }) {
  return (
    <span className={css.math} title={expression}>
      {renderTexToReact(toTexExpression(expression), false)}
    </span>
  )
}
