/**
 * Trusted script frozen into every private question package after its SDK
 * bootstrap. Engine snapshot symbols are LaTeX for the host's math renderer
 * ('\theta', '\theta_0'); the sandboxed canvas has none, so text the authored
 * renderer draws or measures is normalized to the Unicode a canvas can paint.
 * Plain text, non-strings and unknown commands pass through unchanged.
 */
export const CANVAS_TEXT_SHIM = String.raw`
;(() => {
  const named = {
    alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', Theta: 'Θ', kappa: 'κ', lambda: 'λ', Lambda: 'Λ',
    mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ',
    phi: 'φ', varphi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ', Psi: 'Ψ', omega: 'ω', Omega: 'Ω',
    cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
    approx: '≈', propto: '∝', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', circ: '°', degree: '°',
    prime: '′', partial: '∂', parallel: '∥', perp: '⊥', angle: '∠', ldots: '…', cdots: '⋯',
  }
  const sup = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' }
  const sub = {
    0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋',
    a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  }
  const script = (text, table) => {
    const chars = Array.from(text)
    return chars.length > 0 && chars.every(c => table[c] !== undefined) ? chars.map(c => table[c]).join('') : undefined
  }
  const plain = value => {
    if (typeof value !== 'string' || !/[\\$^_]/.test(value)) return value
    return value
      .replace(/\$/g, '')
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|vec|overrightarrow|hat|bar)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
      .replace(/\^\s*\{?\\circ\}?/g, '°')
      .replace(/\\([A-Za-z]+)/g, (match, name) => named[name] ?? match)
      .replace(/\\[,;: !]/g, ' ')
      .replace(/\^\{([^{}]*)\}|\^([0-9n+-])/g, (match, group, single) => script(group ?? single, sup) ?? match)
      .replace(/_\{([^{}]*)\}|_([0-9a-z]+)/g, (match, group, run) => script(group ?? run, sub) ?? match)
  }
  for (const Context of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
    const proto = Context && Context.prototype
    if (!proto) continue
    for (const method of ['fillText', 'strokeText', 'measureText']) {
      const native = proto[method]
      if (typeof native !== 'function') continue
      Object.defineProperty(proto, method, {
        configurable: true,
        writable: true,
        value: function (text, ...rest) { return native.call(this, plain(text), ...rest) },
      })
    }
  }
})()
`
