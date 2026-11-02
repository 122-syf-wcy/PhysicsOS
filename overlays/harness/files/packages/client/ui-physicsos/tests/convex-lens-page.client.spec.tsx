// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { ConvexLensPage } from '../src/client/experiments/ConvexLensPage.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const mount = () => render(<ConvexLensPage runtime={createOpticsWorkspaceRuntime(createConvexLensScene())} t={key => zh[key]} />)

it('offers an apparatus-first page with all five engine-backed imaging conditions', () => {
  const {container} = mount()
  expect(screen.getByRole('heading',{name:'凸透镜成像规律'})).toBeTruthy()
  expect(screen.getByRole('button',{name:'三维装置'})).toBeTruthy()
  expect(screen.queryByRole('button',{name:'运行'})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:/投影仪.*1.5f/}))
  expect(screen.getAllByText(/倒立、放大的实像/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button',{name:/焦点.*u = f/}))
  expect(container.querySelector('[data-image-kind="none"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:/放大镜.*0.5f/}))
  expect(screen.getAllByText(/正立、放大的虚像/).length).toBeGreaterThan(0)
  expect(container.querySelector('[data-screen-lit="false"]')).toBeTruthy()
})

it('records readings, retains them after edits, and exposes report and tutor', () => {
  mount()
  fireEvent.click(screen.getByRole('button',{name:'记录本次'}))
  const input = screen.getByRole('textbox',{name:'物距'})
  fireEvent.change(input,{target:{value:'15'}})
  fireEvent.blur(input)
  fireEvent.click(screen.getByRole('button',{name:'记录本次'}))
  expect(screen.getByRole('table',{name:'实验记录'}).querySelectorAll('tbody tr')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button',{name:'实验报告'}))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getAllByText(/测量记录/).length).toBeGreaterThan(0)
})
