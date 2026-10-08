// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GlassSelect } from '../src/client/GlassSelect.tsx'

afterEach(() => { cleanup() })

const OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待核验' },
  { value: 'verified', label: '已核验' },
  { value: 'rejected', label: '已退回', disabled: true },
] as const

const bench = (value = '', onChange = vi.fn()): { readonly onChange: ReturnType<typeof vi.fn> } => {
  render(
    <GlassSelect
      value={value}
      options={OPTIONS}
      onChange={onChange}
      ariaLabel="状态筛选"
      testId="status"
    />,
  )
  return { onChange }
}

describe('GlassSelect — liquid-glass combobox', () => {
  it('shows the selected label and opens a listbox on click', () => {
    bench('pending')
    const button = screen.getByRole('combobox', { name: '状态筛选' })
    expect(button.textContent).toContain('待核验')
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox', { name: '状态筛选' })
    expect(list).toBeDefined()
    /* The popover lives in a portal under document.body — inside the card it
       would be clipped by `overflow-x: auto`. */
    expect(list.closest('body') !== null).toBe(true)
    expect(screen.getAllByRole('option')).toHaveLength(4)
  })

  it('commits a clicked option and closes the popover', () => {
    const { onChange } = bench('pending')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: '已核验' }))
    expect(onChange).toHaveBeenCalledWith('verified')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('drives selection from the keyboard: arrows move, Enter commits, Escape closes', () => {
    const { onChange } = bench('pending')
    const button = screen.getByRole('combobox')
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeDefined()
    /* Opens on the current value (index 1); ArrowDown lands on 已核验. */
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('verified')

    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('skips disabled options while arrowing', () => {
    const { onChange } = bench('verified')
    const button = screen.getByRole('combobox')
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    /* From 已核验 (index 2) the next row is disabled, so the walk continues
       to 全部状态 (index 0) instead of stopping on it. */
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('closes on an outside pointer press and leaves the value untouched', () => {
    const { onChange } = bench('pending')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders an empty list as a disabled control that opens nothing', () => {
    render(
      <GlassSelect
        value=""
        options={[]}
        onChange={vi.fn()}
        placeholder="— 选择 —"
        ariaLabel="结构模板"
      />,
    )
    const button = screen.getByRole('combobox', { name: '结构模板' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.textContent).toContain('— 选择 —')

    fireEvent.click(button)
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders the placeholder when the value matches no option', () => {
    render(
      <GlassSelect
        value="missing"
        options={OPTIONS}
        onChange={vi.fn()}
        placeholder="请选择"
        ariaLabel="状态筛选"
      />,
    )
    expect(screen.getByRole('combobox').textContent).toContain('请选择')
  })
})
