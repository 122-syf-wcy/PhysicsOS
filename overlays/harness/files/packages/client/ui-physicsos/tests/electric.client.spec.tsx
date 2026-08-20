// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createElectricScene,
  createMagneticScene,
  createMechanicsScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { ElectricLabWorkspace } from '../src/client/ElectricLabWorkspace.tsx'
import { QuestionWorkspace, type QuestionWorkspaceProps } from '../src/client/QuestionWorkspace.tsx'
import type { PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { TimelineScrubber } from '../src/client/TimelineScrubber.tsx'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
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

describe('Electric product slice', () => {
  it('gives the timeline a finite native keyboard step', () => {
    const onChange = vi.fn()
    render(
      <TimelineScrubber
        label="时间轴"
        min={0}
        max={2}
        value={0.5}
        valueText="0.50s"
        onChange={onChange}
      />,
    )

    const slider = screen.getByRole('slider', { name: '时间轴' })
    if (!(slider instanceof HTMLInputElement)) throw new Error('Expected timeline range input.')
    expect(slider.step).toBe('0.002')
    expect(slider.getAttribute('aria-valuetext')).toBe('0.50s')
    fireEvent.change(slider, { target: { value: '1.25' } })
    expect(onChange).toHaveBeenCalledWith(1.25)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(0.502)
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(onChange).toHaveBeenLastCalledWith(0.52)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('selects scene domains from explicit scene facts', () => {
    expect(domainOfScene(createElectricScene())).toBe('electric')
    expect(domainOfScene(createMagneticScene())).toBe('magnetic')
    expect(domainOfScene(createMechanicsScene({ modelId: 'uniform_linear_motion' }))).toBe('mechanics')

    const composite = createElectricScene()
    composite.fields.push(createMagneticScene().fields[0]!)
    expect(domainOfScene(composite)).toBe('unsupported')
  })

  it('renders a verified editable Electric Lab and commits field changes through Scene Runtime', () => {
    const { container } = render(<ElectricLabWorkspace scene={createElectricScene()} t={t} />)

    expect(container.querySelector('[data-physicsos-domain="electric"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    expect(screen.getByText('Electric Engine · Verified')).toBeTruthy()
    const inspectorToggle = screen.getByRole('button', { name: '属性' })
    expect(inspectorToggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(inspectorToggle)
    expect(inspectorToggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭属性面板' }))
    expect(screen.getByRole('combobox', { name: '电场方向' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(inspectorToggle.getAttribute('aria-expanded')).toBe('false')
    const fieldInput = screen.getByText('场强').closest('label')?.querySelector('input')
    if (!(fieldInput instanceof HTMLInputElement)) throw new Error('Expected electric field input.')
    fireEvent.change(fieldInput, { target: { value: '1.2' } })
    fireEvent.blur(fieldInput)
    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    expect(screen.getByText('1.20 V/m')).toBeTruthy()
  })

  it('previews an Electric golden question and passes its exact scene to Lab', () => {
    let openedScene: PhysicsScene | undefined
    const openSurface: NonNullable<QuestionWorkspaceProps['openSurface']> = (_id, sceneRef) => {
      openedScene = sceneRef?.scene as PhysicsScene | undefined
    }
    render(
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={selector => selector({ surface: 'questions' })}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={openSurface}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /正电荷在匀强电场中偏转/ }))
    expect(screen.getByText('Electric Engine · Verified')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '在物理世界中打开' }))
    expect(openedScene?.fields[0]?.type).toBe('uniform_electric')
  })
})
