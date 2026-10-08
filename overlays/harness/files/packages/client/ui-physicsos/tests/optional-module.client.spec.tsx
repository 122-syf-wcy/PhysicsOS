// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { OptionalComponent } from '../src/client/OptionalComponent.tsx'

afterEach(cleanup)

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
