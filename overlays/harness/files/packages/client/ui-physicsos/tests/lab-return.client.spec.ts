import { describe, expect, it } from 'vitest'

import { shouldReturnToConversation } from '../src/client/lab-return.ts'

const state = (over: Partial<Parameters<typeof shouldReturnToConversation>[0]> = {}) => ({
  autoOpened: true,
  wasRunning: true,
  running: false,
  surface: 'lab',
  ...over,
})

describe('the Lab closing itself', () => {
  it('returns to the conversation the moment an auto-opened Lab stops being worked on', () => {
    expect(shouldReturnToConversation(state())).toBe(true)
  })

  it('leaves a Lab the reader opened themselves alone', () => {
    expect(shouldReturnToConversation(state({ autoOpened: false }))).toBe(false)
  })

  it('stays put while the turn is still running, and after it has already returned', () => {
    expect(shouldReturnToConversation(state({ running: true }))).toBe(false)
    expect(shouldReturnToConversation(state({ wasRunning: false }))).toBe(false)
  })

  it('never pulls the reader off another surface', () => {
    expect(shouldReturnToConversation(state({ surface: 'record' }))).toBe(false)
    expect(shouldReturnToConversation(state({ surface: 'home' }))).toBe(false)
  })
})
