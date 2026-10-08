/**
 * TeX-to-React via KaTeX for PhysicsOS HTML surfaces.
 *
 * `renderTexToReact` is not part of the primitives' package root and the
 * package's `./src/*` face cannot be imported with a `.tsx` extension from
 * another package's build (TS2877), so PhysicsOS keeps its own equivalent:
 * KaTeX emits an HTML string and the browser's own parser (DOMParser, applying
 * the spec's SVG/MathML foreign-content adjustments KaTeX output relies on)
 * turns it into a tree this module maps onto React elements. KaTeX output is a
 * static span/MathML/SVG vocabulary with no raw user HTML.
 *
 * React 18 has no MathML support, so the `.katex-mathml` subtree's elements
 * land in the HTML namespace — the visual arm is the `.katex-html` span tree
 * and the MathML arm serves assistive technology by tag name.
 */

import { createElement } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import katex from 'katex'

/** Convert one inline `style` attribute string into React's style object. */
function styleObject(css: string): CSSProperties {
  const style: Record<string, string> = {}
  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const name = declaration.slice(0, colon).trim()
    style[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())]
      = declaration.slice(colon + 1).trim()
  }
  return style
}

/** Map one parsed DOM node onto a React element (text nodes pass through). */
function domToReact(node: ChildNode, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const element = node as Element
  const props: Record<string, unknown> = { key }
  for (const attribute of element.attributes) {
    if (attribute.name === 'class') props['className'] = attribute.value
    else if (attribute.name === 'style') props['style'] = styleObject(attribute.value)
    else props[attribute.name] = attribute.value
  }
  const children = [...element.childNodes].map(domToReact)
  return children.length === 0
    ? createElement(element.localName, props)
    : createElement(element.localName, props, ...children)
}

/**
 * Render TeX source to React elements through KaTeX.
 * @param value - the TeX source.
 * @param displayMode - display (block) versus inline rendering.
 * @returns KaTeX's element tree, or the error span when the source does not parse.
 */
export function renderTexToReact(value: string, displayMode: boolean): ReactNode {
  let html: string
  try {
    html = katex.renderToString(value, { displayMode, throwOnError: true })
  } catch (error) {
    try {
      html = katex.renderToString(value, { displayMode, strict: 'ignore', throwOnError: false })
    } catch {
      return (
        <span className="katex-error" style={{ color: '#cc0000' }} title={String(error)}>
          {value}
        </span>
      )
    }
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return [...parsed.body.childNodes].map(domToReact)
}
