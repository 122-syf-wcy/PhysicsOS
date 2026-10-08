// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OptionalComponent } from '../src/client/OptionalComponent.tsx'

import { SceneTurnCard, type SceneTurnCardProps } from '../src/client/SceneTurnCard.tsx'
import * as optionalModules from '../src/client/optional-modules.ts'
import { PHYSICS_SCENE_TURN_KEY } from '../src/client/scene-chat-node.ts'
import { solvedCardData } from './solved-card-fixture.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('loads only when mounted and renders a retry action after a transient chunk failure', async () => {
  let calls = 0
  const load = async () => {
    calls += 1
    if (calls === 1) throw new Error('offline')
    return { default: () => <p>Optional bench ready</p> }
  }
  expect(calls).toBe(0)
  render(<OptionalComponent load={load} componentProps={{}} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('Optional bench ready')).toBeTruthy()
  expect(calls).toBe(2)
})


it('keeps empty turn tails lightweight and loads the card body only for a published scene', async () => {
  const load = vi.spyOn(optionalModules, 'loadWorkspaceModule').mockResolvedValue({
    SceneCardBody: () => <p>Loaded turn scene</p>,
  } as unknown as Awaited<ReturnType<typeof optionalModules.loadWorkspaceModule>>)
  const hygiene = vi.fn()
  const props = {
    turn: { data: new Map() }, t: (key: string) => key,
    openSceneInLab: vi.fn(), endTurnHygiene: hygiene,
  } as unknown as SceneTurnCardProps
  const view = render(<SceneTurnCard {...props} />)
  expect(load).not.toHaveBeenCalled()
  expect(hygiene).toHaveBeenCalledTimes(1)
  view.rerender(<SceneTurnCard {...props} turn={{
    data: new Map([[PHYSICS_SCENE_TURN_KEY, solvedCardData('electric-01-perpendicular-deflection')]]),
  } as unknown as SceneTurnCardProps['turn']} />)
  expect(await screen.findByText('Loaded turn scene')).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(1)
})
