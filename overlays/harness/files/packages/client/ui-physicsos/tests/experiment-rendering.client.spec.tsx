import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { EXPERIMENT_TEMPLATES } from '../src/client/physics/experiment-templates.ts'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { createPhotoelectricEffectScene } from '@physicsos/physics-scene'

describe('every selectable experiment has a working canvas', () => {
  it.each(EXPERIMENT_TEMPLATES.filter(template => !template.comingSoon))(
    '$id renders its real runtime output without a missing renderer',
    template => {
      const { scene } = template.createScene(template.id)
      const runtime = buildWorkspaceRuntime(domainOfScene(scene), scene)
      expect(runtime).not.toBeNull()
      const snapshot = runtime!.getSnapshot()
      expect(snapshot.status).not.toBe('failed')
      const markup = renderToStaticMarkup(
        <PhysicsCanvas view={snapshot.view} ariaLabel={template.id} />,
      )
      expect(markup).toContain('role="img"')
      expect(markup).not.toContain('NaN')
      expect(markup).not.toContain('Infinity')
    },
  )
})

describe('photoelectric apparatus', () => {
  it.each([
    { wavelength: 400, emits: true },
    { wavelength: 800, emits: false },
  ])('shows emitted electrons only when the engine emits at $wavelength nm', ({ wavelength, emits }) => {
    const scene = createPhotoelectricEffectScene({ photonWavelengthNm: wavelength })
    const runtime = buildWorkspaceRuntime(domainOfScene(scene), scene)!
    const snapshot = runtime.getSnapshot()
    const markup = renderToStaticMarkup(<PhysicsCanvas view={snapshot.view} ariaLabel="光电效应" />)
    expect(markup).toContain('data-testid="photoelectric-cathode"')
    expect(markup.includes('data-testid="photoelectric-electron"')).toBe(emits)
    // Apparatus layout is schematic; centimetre axes would claim a measurement.
    expect(snapshot.view.axes).toEqual({ x: '', y: '' })
    expect(snapshot.view.overlay.scale.label).toBe('')
  })
})
