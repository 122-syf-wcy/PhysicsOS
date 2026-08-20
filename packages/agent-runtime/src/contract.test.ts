import { describe, expect, it } from 'vitest'
import type { AgentClientEvent, AgentTransport, PhysicsAgentRuntime } from './index.ts'

function assertNever(value: never): never {
  throw new Error(`unexpected event: ${String(value)}`)
}

function eventType(event: AgentClientEvent): AgentClientEvent['type'] {
  switch (event.type) {
    case 'text_delta':
    case 'status_changed':
    case 'tool_started':
    case 'tool_completed':
    case 'scene_changed':
    case 'observation_changed':
    case 'verification_completed':
    case 'run_completed':
    case 'run_failed':
      return event.type
    default:
      return assertNever(event)
  }
}

describe('PhysicsAgentRuntime contract', () => {
  it('requires the stable runtime methods', () => {
    const keys: Array<keyof PhysicsAgentRuntime> = [
      'createSession',
      'send',
      'resume',
      'cancel',
      'getSession',
      'forkSession',
    ]
    expect(keys).toHaveLength(6)
  })

  it('requires transport streaming methods', () => {
    const keys: Array<keyof AgentTransport> = ['createSession', 'send', 'cancel', 'resume']
    expect(keys).toEqual(['createSession', 'send', 'cancel', 'resume'])
  })

  it('keeps client events as a closed discriminated union', () => {
    const sample: AgentClientEvent = { type: 'text_delta', text: 'hello' }
    expect(eventType(sample)).toBe('text_delta')
  })
})
