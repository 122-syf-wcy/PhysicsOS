import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhysicsButton } from './physics-button.tsx'

describe('PhysicsButton', () => {
  it('renders a labeled primary action', () => {
    render(<PhysicsButton>进入实验室</PhysicsButton>)
    expect(screen.getByRole('button', { name: '进入实验室' })).toBeTruthy()
  })
})
