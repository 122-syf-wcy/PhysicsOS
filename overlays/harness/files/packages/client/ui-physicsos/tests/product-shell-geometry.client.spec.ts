import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
// These contracts run against the server's clean overlay projection. They do
// not claim to replace the real-page geometry script in this directory.
describe('shell rail/inset single source of truth', () => {
  it('derives the center inset from the same rail dimensions, not a page-local padding', () => {
    const css = read('../../ui-layout/src/client/AppFrame.module.css')
    const sidebar = read('../../ui-sidebar/src/client/SidebarRoot.module.css')
    expect(css).toContain('--physicsos-shell-rail-left: 30px')
    expect(css).toContain('--physicsos-shell-rail-padding: 13px')
    expect(css).toContain('--physicsos-shell-rail-button: 48px')
    expect(css).toContain('--physicsos-shell-rail-border: 1px')
    expect(css).toContain('margin-left: var(--physicsos-shell-content-inset)')
    expect(css).not.toContain('margin-left: 82px')
    expect(sidebar).toContain('width: var(--physicsos-shell-rail-width)')
    expect(sidebar).toContain('padding: 16px var(--physicsos-shell-rail-padding)')
    const rightEdge = 30 + 2 * 13 + 48 + 2
    const contentInset = rightEdge + 14
    expect(rightEdge).toBe(106)
    expect(contentInset).toBe(120)
  })
  it('uses the CSS-used margin for both column solves and rightbar clamp', () => {
    const source = read('../../ui-layout/src/client/AppFrame.tsx')
    expect(source).toContain('getComputedStyle(center).marginLeft')
    expect(source).toContain('Math.max(0, viewport - productInset)')
    expect(source.match(/computeColumns\(contentViewport,/g)).toHaveLength(2)
    expect(source).toContain('contentViewport * RIGHTBAR_MAX_RATIO')
    expect(source).not.toContain('viewport > 600 ? 82 : 0')
    expect(source).toContain('viewport <= 600')
  })
  it('has one frame compact boundary, safe-area clearance, and internally scrollable short rails', () => {
    const css = read('../../ui-layout/src/client/AppFrame.module.css')
    const sidebar = read('../../ui-sidebar/src/client/SidebarRoot.module.css')
    const nav = read('../src/client/SidebarNav.module.css')
    expect(css).toContain('.frame[data-product-compact]')
    expect(css).toContain('env(safe-area-inset-bottom, 0px)')
    expect(css).toContain('margin-bottom: var(--physicsos-shell-bottom-inset)')
    expect(sidebar).toContain(':global([data-product-compact]) .productRail')
    expect(sidebar).toContain('overscroll-behavior: contain')
    expect(sidebar).toContain('max-height: max(0px, calc(100% - var(--physicsos-shell-header)')
    expect(nav).toContain('var(--physicsos-shell-rail-button, 44px)')
    expect(6 * 44 + 5 * 2 + 2 * 8 + 2).toBeLessThanOrEqual(320 - 24)
  })
  it('keeps recent buttons in distinct visible flow boxes rather than hover-only overlays', () => {
    const css = read('../src/client/RecentSpaces.module.css')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(css).toContain('.actions { display: flex')
    expect(css).toContain('min-width: 44px; min-height: 44px')
    expect(css).not.toContain('display: none;\n  align-items: center;\n  justify-content: center;\n  width: 20px')
    expect(css).not.toContain('right: 6px')
  })
})
