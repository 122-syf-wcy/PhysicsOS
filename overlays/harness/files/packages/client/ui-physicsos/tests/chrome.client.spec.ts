// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { mountPhysicsOSChrome } from '../src/client/chrome.ts'

afterEach(() => {
  document.head.querySelectorAll('style[data-physicsos-chrome]').forEach((node) => { node.remove() })
})

/**
 * A physics token that fails to resolve does not fall back to a visible colour:
 * `stroke: var(--missing)` is invalid at computed-value time and reverts to the
 * inherited value, which is `none` beneath the canvas's `<svg fill="none">`. The
 * whole canvas then renders blank while every element is still in the DOM, so
 * these assertions guard a silent, total visual failure.
 */
describe('mountPhysicsOSChrome', () => {
  it('installs the physics semantic tokens the canvas paints with', () => {
    mountPhysicsOSChrome()
    const style = document.head.querySelector('style[data-physicsos-chrome]')
    const css = style?.textContent ?? ''

    for (const token of [
      '--physics-vector-velocity',
      '--physics-vector-force',
      '--physics-vector-acceleration',
      '--physics-vector-gravity',
      '--physics-vector-normal',
      '--physics-vector-friction',
      '--physics-trajectory',
      '--physics-trajectory-predicted',
      '--physics-field',
      '--physics-measurement',
      '--physics-angle',
      '--physics-canvas-bg',
      '--physics-canvas-text',
      '--physics-canvas-text-muted',
      '--physics-grid-minor',
      '--physics-grid-major',
      '--physics-axis',
      '--physics-body-fill',
      '--physics-body-stroke',
      '--physics-surface-hatch',
      '--physics-incline-fill',
      '--physics-keypoint-launch',
      '--physics-keypoint-apex',
      '--physics-keypoint-impact',
      '--physics-subject-mechanics',
      '--physics-subject-electric',
      '--physics-subject-magnetic',
      '--physics-subject-composite',
      '--physics-subject-mechanics-tint',
      '--physics-subject-electric-tint',
      '--physics-subject-magnetic-tint',
      '--physics-subject-composite-tint',
      '--physics-highlight',
      '--physics-motion-fast',
      '--physics-motion-entrance',
      '--physics-ease-emphasized',
    ]) {
      expect(css, `chrome CSS must define ${token}`).toContain(`${token}:`)
    }
  })

  it('keeps a single chrome style tag across remounts and removes its own on dispose', () => {
    const dispose = mountPhysicsOSChrome()
    expect(document.head.querySelectorAll('style[data-physicsos-chrome]')).toHaveLength(1)
    dispose()
    expect(document.head.querySelectorAll('style[data-physicsos-chrome]')).toHaveLength(0)

    /* A remount replaces rather than stacks, so a hot reload cannot leave two
       competing token blocks in the document. */
    mountPhysicsOSChrome()
    const second = mountPhysicsOSChrome()
    expect(document.head.querySelectorAll('style[data-physicsos-chrome]')).toHaveLength(1)
    second()
    expect(document.head.querySelectorAll('style[data-physicsos-chrome]')).toHaveLength(0)
  })

  it('follows the host palette: surfaces bind at body scope and darken with the theme', () => {
    mountPhysicsOSChrome()
    const css = document.head.querySelector('style[data-physicsos-chrome]')?.textContent ?? ''

    /* The host writes its alias palette onto body. A surface token defined on the
       root element would resolve against the root, find nothing, and silently
       keep its light hex — leaving a white desk under a dark host. */
    expect(css, 'the desk must follow the host palette from body scope')
      .toMatch(/body\s*\{[^}]*--physics-workspace-bg:\s*var\(--dsw-alias-bg-base/)
    expect(css, 'a root-scoped definition silently falls back to the light hex')
      .not.toMatch(/:root\s*\{[^}]*--physics-workspace-bg/)

    /* The desk and the floating panels go dark; the sheet above them does not,
       because the physics inks are tuned against a white canvas. */
    const darkBlocks = [...css.matchAll(/body\[data-ds-dark-theme\]\s*\{([^}]*)\}/g)]
      .map(match => match[1])
      .join('\n')
    for (const token of [
      '--physics-glass-fill',
      '--physics-glass-border',
      '--physics-glass-shadow',
      '--physics-glass-inset',
      '--physics-glass-plate',
      '--dsh-scrollbar-thumb',
    ]) {
      expect(darkBlocks, `the dark palette must redefine ${token}`).toContain(token)
    }
    expect(darkBlocks, 'the canvas sheet keeps its fixed light ink')
      .not.toContain('--physics-canvas-bg')
  })
})
