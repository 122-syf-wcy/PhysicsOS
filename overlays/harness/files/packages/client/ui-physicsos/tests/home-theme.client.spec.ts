import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = (file: string): string =>
  readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('home dark theme', () => {
  it('darkens the hero glass plate instead of keeping the baked light gradient', () => {
    const source = css('HomeBrand.module.css')

    expect(source).toContain(':global(body[data-ds-dark-theme]) .stage')
    expect(source).toContain('--dsw-alias-bg-layer-2')
    expect(source).toContain('--physics-grid-major: rgba(148, 163, 184, 0.2)')
    expect(source).toContain(':global(body[data-ds-dark-theme]) .copy::before')
  })

  it('keeps the action cards and their image wells on the dark surface ramp', () => {
    const source = css('HomeActions.module.css')

    expect(source).toContain(':global(body[data-ds-dark-theme]) .portalIcon')
    expect(source).toContain(':global(body[data-ds-dark-theme]) .portalImage')
    expect(source).toContain('brightness(0.58)')
  })

  it('re-reads the canvas palette when the host theme attribute changes', () => {
    const source = readFileSync(
      new URL('../src/client/HomePlayground.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('new MutationObserver(refreshPalette)')
    expect(source).toContain("attributeFilter: ['data-ds-dark-theme', 'class', 'style']")
  })
})
