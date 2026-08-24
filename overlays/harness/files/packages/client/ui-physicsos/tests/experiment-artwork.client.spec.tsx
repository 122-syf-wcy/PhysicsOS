// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import {
  ExperimentArt,
  TEMPLATE_ART,
  artTemplateIdOfSceneId,
  resolveArtKey,
} from '../src/client/physics/experiment-artwork.tsx'
import {
  EXPERIMENT_TEMPLATES,
  createExperimentSceneRef,
} from '../src/client/physics/experiment-templates.ts'

afterEach(cleanup)

describe('experiment artwork registry', () => {
  it('has dedicated scene art for every template, comingSoon included', () => {
    for (const template of EXPERIMENT_TEMPLATES) {
      expect(TEMPLATE_ART[template.id], `template ${template.id} needs artwork`).toBeDefined()
    }
  })

  it('draws real strokes for every registered piece, never an empty stage', () => {
    for (const key of Object.keys(TEMPLATE_ART)) {
      const { container, unmount } = render(<ExperimentArt templateId={key} />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('data-physicsos-art')).toBe(key)
      /* At least one painted element: a blank composition would pass a plain
         "renders" check while shipping an empty tile. */
      expect(
        svg?.querySelectorAll('path, line, circle, rect, ellipse').length ?? 0,
        `artwork ${key} must draw something`,
      ).toBeGreaterThan(0)
      unmount()
    }
  })
})

describe('artTemplateIdOfSceneId', () => {
  it('recovers every creatable template from its own stamped scene id', () => {
    /* Round trip through the REAL registry: if a template's scene id base ever
       drifts from SCENE_ID_BASES, the stored 继续上次实验 card silently falls
       back to generic art — this pins the mapping to production ids. */
    for (const template of EXPERIMENT_TEMPLATES.filter(entry => entry.comingSoon !== true)) {
      const { sceneId } = createExperimentSceneRef(template, template.id)
      expect(artTemplateIdOfSceneId(sceneId), sceneId).toBe(template.id)
    }
  })

  it('keeps prefix-sharing ids apart (composite-eb vs composite-ebg)', () => {
    expect(artTemplateIdOfSceneId('composite-eb-1724480000000-1')).toBe('composite-eb')
    expect(artTemplateIdOfSceneId('composite-ebg-1724480000000-1')).toBe('composite-ebg')
  })

  it('returns undefined for scenes that never came from a template', () => {
    expect(artTemplateIdOfSceneId('agent-built-scene-42')).toBeUndefined()
    expect(artTemplateIdOfSceneId('question-em-lorentz-1')).toBeUndefined()
  })
})

describe('resolveArtKey', () => {
  it('prefers the dedicated template art and falls back by scene kind', () => {
    expect(resolveArtKey('magnetic-circular', 'question')).toBe('magnetic-circular')
    expect(resolveArtKey(undefined, 'question')).toBe('question')
    expect(resolveArtKey(undefined, 'experiment')).toBe('lab')
    expect(resolveArtKey('no-such-template', undefined)).toBe('lab')
  })
})

describe('<ExperimentArt />', () => {
  it('letterboxes by default and crops to fill when fit="cover"', () => {
    const contain = render(<ExperimentArt templateId="incline" />)
    expect(contain.container.querySelector('svg')?.getAttribute('preserveAspectRatio'))
      .toBe('xMidYMid meet')
    contain.unmount()

    const cover = render(<ExperimentArt templateId="incline" fit="cover" />)
    expect(cover.container.querySelector('svg')?.getAttribute('preserveAspectRatio'))
      .toBe('xMidYMid slice')
  })

  it('stays decorative: hidden from the accessibility tree', () => {
    const { container } = render(<ExperimentArt templateId="point-charge" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('focusable')).toBe('false')
  })
})
