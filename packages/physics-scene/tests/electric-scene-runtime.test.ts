import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'

import {
  SceneRuntime,
  createElectricScene,
  createSceneCommand,
} from '../src/index.ts'

describe('Electric Scene Runtime', () => {
  it('changes field strength while preserving direction', () => {
    const runtime = new SceneRuntime(createElectricScene({
      electricFieldStrength: 2,
      electricFieldDirection: 'down',
    }))
    const scene = runtime.getScene()
    const result = runtime.execute(createSceneCommand({
      commandId: 'electric-strength',
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type: 'SetElectricFieldStrength',
      payload: {
        fieldId: 'electric-field-1',
        strength: quantity(5, 'V/m', 'electric_field'),
      },
      traceId: 'trace-electric-strength',
    }))

    expect(result.ok).toBe(true)
    const field = runtime.getScene().fields[0]
    expect(field?.type).toBe('uniform_electric')
    if (field?.type !== 'uniform_electric') throw new Error('Expected uniform electric field.')
    expect(field.fieldStrength.vector).toEqual({ x: 0, y: -5, z: 0 })
    expect(runtime.getEvents()[0]?.type).toBe('ElectricFieldStrengthChanged')
  })

  it('changes field direction while preserving magnitude', () => {
    const runtime = new SceneRuntime(createElectricScene({
      electricFieldStrength: 3,
      electricFieldDirection: 'right',
    }))
    const scene = runtime.getScene()
    const result = runtime.execute(createSceneCommand({
      commandId: 'electric-direction',
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type: 'SetElectricFieldDirection',
      payload: { fieldId: 'electric-field-1', direction: 'up' },
      traceId: 'trace-electric-direction',
    }))

    expect(result.ok).toBe(true)
    const field = runtime.getScene().fields[0]
    expect(field?.type).toBe('uniform_electric')
    if (field?.type !== 'uniform_electric') throw new Error('Expected uniform electric field.')
    expect(field.fieldStrength.vector).toEqual({ x: 0, y: 3, z: 0 })
    expect(runtime.getEvents()[0]?.type).toBe('ElectricFieldDirectionChanged')
  })

  it('rejects invalid electric edits atomically', () => {
    const runtime = new SceneRuntime(createElectricScene())
    const before = runtime.getScene()
    const result = runtime.execute(createSceneCommand({
      commandId: 'electric-invalid',
      sceneId: String(before.id),
      expectedRevision: before.revision,
      type: 'SetElectricFieldStrength',
      payload: {
        fieldId: 'electric-field-1',
        strength: quantity(-1, 'V/m', 'electric_field'),
      },
      traceId: 'trace-electric-invalid',
    }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected command rejection.')
    expect(result.error.code).toBe('INVALID_ELECTRIC_FIELD_STRENGTH')
    expect(runtime.getScene()).toEqual(before)
    expect(runtime.getEvents()).toEqual([])
  })
})
