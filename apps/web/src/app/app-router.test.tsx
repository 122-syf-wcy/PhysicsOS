import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { HomePage } from '../pages/home-page.tsx'
import { PhysicsWorkspacePage } from '../pages/physics-workspace-page.tsx'
import { QuestionSpacePage } from '../pages/question-space-page.tsx'
import { WebShell } from './web-shell.tsx'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<WebShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/lab" element={<PhysicsWorkspacePage />} />
          <Route path="/questions" element={<QuestionSpacePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('route smoke', () => {
  it('renders home hero', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: '让看不见的物理过程被看见' })).toBeTruthy()
  })

  it('renders physics workspace canvas', () => {
    renderAt('/lab')
    expect(screen.getByRole('img', { name: '磁场中带电粒子运动画布' })).toBeTruthy()
  })

  it('renders question space', () => {
    renderAt('/questions')
    expect(screen.getByRole('heading', { name: '带电粒子在匀强磁场中做圆周运动' })).toBeTruthy()
  })
})
