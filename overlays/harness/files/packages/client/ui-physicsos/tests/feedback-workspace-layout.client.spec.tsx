// @vitest-environment jsdom
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PhysicsWorkspace } from '../src/client/PhysicsWorkspace.tsx'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { universalContributionSnapshot } from '../src/client/experiments/contribution-protocol.ts'
import { zh } from '../src/client/locales.ts'
import css from '../src/client/LabWorkspace.module.css'
import renderCss from '../src/client/physics/renderers.module.css'
import selectCss from '../src/client/GlassSelect.module.css'
import canvasCss from '../src/client/physics/PhysicsCanvas.module.css'
import primitiveCss from '../src/client/physics/primitives.module.css'
import mathCss from '../src/client/physics/MathText.module.css'
import { mountPhysicsOSChrome } from '../src/client/chrome.ts'

// Export actual component markup and styles, not a duplicate layout, for the
// Chromium viewport/occlusion checks. Engine-generated charts stay in the fixture.
it('exports a chart-capable workspace with its current engine snapshot for browser verification', async () => {
  const template = findExperimentTemplate('rheostat-circuit')!
  const runtime = buildWorkspaceRuntime(template.domain, template.createScene(zh[template.label]).scene)!
  const markup = renderToStaticMarkup(<PhysicsWorkspace runtime={runtime} t={key => zh[key] ?? key} />)
  const linkedStyles = [...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link => link.outerHTML).join('')
  const disposeChrome = mountPhysicsOSChrome()
  let styles = document.head.querySelector('style[data-physicsos-chrome]')?.textContent ?? ''
  disposeChrome()
  for (const [name, classes] of [
    ['LabWorkspace.module.css', css], ['physics/renderers.module.css', renderCss], ['GlassSelect.module.css', selectCss],
    ['physics/PhysicsCanvas.module.css', canvasCss], ['physics/primitives.module.css', primitiveCss],
    ['physics/MathText.module.css', mathCss],
  ] as const) {
    styles += (await readFile(resolve('packages/client/ui-physicsos/src/client', name), 'utf8'))
      .replace(/\.([a-zA-Z][\w-]*)/g, (all, key: string) => classes[key] ? `.${classes[key]}` : all)
      .replace(/:global\(([^()]*)\)/g, '$1') + '\n'
  }
  const fixture = process.env.PHYSICSOS_FEEDBACK_FIXTURE ?? '/tmp/physicsos-feedback-common'
  await writeFile(`${fixture}.html`, `<!doctype html><meta charset="utf-8">${linkedStyles}<style>
    html,body {margin:0;height:100%;font:14px system-ui;--dsw-alias-bg-base:#fff;--dsw-alias-bg-module-platform:#eef2ee;--dsw-alias-border-l2:#cad7cf;--dsw-alias-label-primary:#243c31;--dsw-alias-label-secondary:#51695d;--physicsos-focus:#368b67}
    * {box-sizing:border-box} button,input {font:inherit} #workspace {position:absolute;top:40px;right:0;bottom:0;left:300px}
    @media(max-width:600px) {#workspace {left:0;top:0}}
    ${styles}</style><main id="workspace">${markup}</main>`)
  await writeFile(`${fixture}-snapshot.json`, JSON.stringify(universalContributionSnapshot(runtime.getSnapshot(), template.id)))
  expect(runtime.getSnapshot().charts.length).toBeGreaterThan(0)
  expect(markup).toContain('I - t')
})
