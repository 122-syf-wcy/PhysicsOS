// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PhysicsSurface,
  buildWorkspaceRuntime,
  type PhysicsSurfaceProps,
} from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { workspaceCapabilities } from '../src/client/physics/experiment-capabilities.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mountLab = (templateId: string) => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  const surface = createPhysicsSurfaceController()
  surface.open('lab', createExperimentSceneRef(template, t(template.label)))
  const view = render(
    <PhysicsSurface
      useLearningRecord={neverHook}
      useRecentExperiments={neverHook}
      usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
      t={t}
      useSessions={neverHook}
      useWorkspaces={neverHook}
      useAuth={neverHook}
    />,
  )
  return { ...view, surface }
}

const coverOf = (): HTMLElement => {
  const cover = document.querySelector<HTMLElement>('[data-physicsos-surface="lab"]')
  if (cover === null) throw new Error('the lab cover did not mount')
  return cover
}

/** The capability the manifest declares for a template, read off its own runtime. */
const declaredTimeline = (templateId: string): boolean => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  const { scene } = template.createScene('capabilities')
  const runtime = buildWorkspaceRuntime(domainOfScene(scene), scene)
  if (runtime === null) throw new Error(`no workspace runtime for ${templateId}`)
  return workspaceCapabilities(runtime.getSnapshot()).timeline
}

/* One case per model kind (see experiment-capabilities.ts). `series-circuit` and
   `plane-mirror` are the total = 0 domains the audit named. */
const CASES = [
  { id: 'series-circuit', kind: 'static' },
  { id: 'plane-mirror', kind: 'static' },
  { id: 'thermometer', kind: 'static' },
  { id: 'straight-wire-field', kind: 'static' },
  { id: 'mechanical-energy', kind: 'static' },
  { id: 'lever-balance', kind: 'quasi-static' },
  { id: 'rheostat-circuit', kind: 'quasi-static' },
  { id: 'magnetic-circular', kind: 'analytical' },
  { id: 'projectile-horizontal', kind: 'analytical' },
  { id: 'collision-elastic', kind: 'dynamic' },
] as const

describe.each(CASES)('capability-driven transport · $id ($kind)', ({ id }) => {
  it('renders the transport exactly when the manifest declares a timeline', () => {
    const { container } = mountLab(id)
    const timeline = declaredTimeline(id)

    expect(coverOf().dataset['physicsosTimeline']).toBe(timeline ? 'true' : 'false')

    /* Toolbar transport group: present with a timeline, absent without one —
       never present-but-disabled. */
    if (timeline) {
      expect(screen.getByRole('button', { name: '运行' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '重置' })).toBeTruthy()
    } else {
      expect(screen.queryByRole('button', { name: '运行' })).toBeNull()
      expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
      expect(screen.queryByRole('button', { name: '重置' })).toBeNull()
    }

    /* Timeline row: the whole row goes, not just its buttons. */
    if (timeline) {
      expect(screen.getByRole('button', { name: '播放 / 暂停' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '后退一步' })).toBeTruthy()
      expect(screen.getByRole('slider', { name: '时间轴' })).toBeTruthy()
      expect(screen.getByRole('combobox', { name: '播放倍速' })).toBeTruthy()
    } else {
      expect(screen.queryByRole('button', { name: '播放 / 暂停' })).toBeNull()
      expect(screen.queryByRole('button', { name: '后退一步' })).toBeNull()
      expect(screen.queryByRole('slider', { name: '时间轴' })).toBeNull()
      expect(screen.queryByRole('combobox', { name: '播放倍速' })).toBeNull()
      /* And no leftover transport chrome carrying a dead control. */
      expect(container.querySelectorAll('[class*="transport"]')).toHaveLength(0)
      expect(container.querySelectorAll('[class*="playbackTools"]')).toHaveLength(0)
    }
  })
})

describe('a timeline-less experiment loses only the transport', () => {
  it('keeps the scene tree and the editable inspector', () => {
    mountLab('series-circuit')

    /* The controls that remain meaningful are still there: the student can read
       the apparatus, edit parameters and re-solve. */
    expect(screen.getByRole('region', { name: '场景与对象' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '检查器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '检查器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '报告' })).toBeTruthy()
    expect(screen.getByRole('img')).toBeTruthy()
  })

  it('leaves no control behind that is merely disabled', () => {
    mountLab('series-circuit')

    /* The audit's complaint was "the same toolbar with half the buttons grey".
       After the change the only disabled control is the deliberate 更多
       placeholder — nothing that looks like playback. */
    const disabled = [...coverOf().querySelectorAll('button:disabled')]
    expect(disabled.map(button => button.getAttribute('aria-label'))).toEqual(['更多'])
  })
})
