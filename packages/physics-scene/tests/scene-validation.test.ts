import { describe, expect, it } from 'vitest'

import { UNIT_Y, UNIT_Z, vec3 } from '@physicsos/physics-math'
import { asObservableId, asSceneId } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import { defaultCoordinateSystem, validateScene } from '../src/scene-validation.ts'
import { type PhysicsScene } from '../src/scene.ts'

describe('Scene Validation', () => {
  const minimalScene = (): PhysicsScene => ({
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId('scene-1'),
    revision: 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [],
    particles: [],
    fields: [],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    measurementDefinitions: [],
    observableDefinitions: [],
    annotations: [],
    metadata: {
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    },
  })

  it('accepts a structurally valid scene', () => {
    const scene = minimalScene()
    const result = validateScene(scene)
    expect(result.status).toBe('passed')
  })

  it('rejects negative revision', () => {
    const scene = minimalScene()
    scene.revision = -1
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'scene_revision_valid')).toBe(true)
  })

  it('rejects non-integer revision', () => {
    const scene = minimalScene()
    scene.revision = 0.5
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'scene_revision_valid')).toBe(true)
  })

  it('rejects duplicate object ids', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(1e-27, 'kg', 'mass'),
        position: { vector: vec3(0, 0, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 0, 0), unit: 'm/s', dimension: 'velocity' },
      },
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(1e-27, 'kg', 'mass'),
        position: { vector: vec3(0, 1, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 0, 0), unit: 'm/s', dimension: 'velocity' },
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'scene_object_ids_unique')).toBe(true)
  })

  it('rejects mass <= 0', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(0, 'kg', 'mass'),
        position: { vector: vec3(0, 0, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 0, 0), unit: 'm/s', dimension: 'velocity' },
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'particle_mass_positive:p1')).toBe(true)
  })

  it('rejects NaN position', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(1e-27, 'kg', 'mass'),
        position: { vector: vec3(Number.NaN, 0, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 0, 0), unit: 'm/s', dimension: 'velocity' },
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'particle_position_finite:p1')).toBe(true)
  })

  it('rejects Infinity velocity', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(1e-27, 'kg', 'mass'),
        position: { vector: vec3(0, 0, 0), unit: 'm', dimension: 'length' },
        velocity: {
          vector: vec3(Number.POSITIVE_INFINITY, 0, 0),
          unit: 'm/s',
          dimension: 'velocity',
        },
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'particle_velocity_finite:p1')).toBe(true)
  })

  it('rejects invalid unit', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: { value: 1e-27, unit: 'unknown_unit', dimension: 'mass' },
        position: { vector: vec3(0, 0, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 0, 0), unit: 'm/s', dimension: 'velocity' },
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'particle_units_known:p1')).toBe(true)
  })

  it('rejects known units used with the wrong particle dimension', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(1e-27, 'kg', 'mass'),
        charge: quantity(1.6e-19, 'C', 'electric_charge'),
        position: { vector: vec3(0, 0, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 0, 0), unit: 'm/s', dimension: 'velocity' },
      },
    ]
    Reflect.set(scene.particles[0]!.mass, 'unit', 's')
    Reflect.set(scene.particles[0]!.mass, 'dimension', 'time')

    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'particle_dimensions_valid:p1')).toBe(true)
  })

  it('rejects wrong field and timeline dimensions without throwing', () => {
    const scene = minimalScene()
    const field = {
      id: 'b1',
      type: 'uniform_magnetic' as const,
      magneticFluxDensity: {
        vector: vec3(0, 0, 0.5),
        unit: 'T',
        dimension: 'magnetic_flux_density' as const,
      },
    }
    scene.fields = [field]
    Reflect.set(field.magneticFluxDensity, 'unit', 'm/s')
    Reflect.set(field.magneticFluxDensity, 'dimension', 'velocity')
    Reflect.set(scene.timeline.currentTime, 'unit', 'm')
    Reflect.set(scene.timeline.currentTime, 'dimension', 'length')

    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'field_dimensions_valid:b1')).toBe(true)
    expect(result.errors.some((e) => e.code === 'timeline_dimensions_valid')).toBe(true)
  })

  it('rejects zero coordinate axis', () => {
    const scene = minimalScene()
    scene.coordinateSystem = {
      type: 'cartesian',
      origin: vec3(0, 0, 0),
      axes: { x: vec3(0, 0, 0), y: UNIT_Y, z: UNIT_Z },
      lengthUnit: 'm',
    }
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'coordinate_axes_valid')).toBe(true)
  })

  it('rejects playbackRate <= 0', () => {
    const scene = minimalScene()
    scene.timeline.playbackRate = 0
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code === 'timeline_playback_rate_valid')).toBe(true)
  })

  it('rejects observable targeting non-existent object', () => {
    const scene = minimalScene()
    scene.observableDefinitions = [
      {
        id: asObservableId('obs-1'),
        type: 'velocity',
        targetId: 'nonexistent',
        visible: true,
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('failed')
    expect(result.errors.some((e) => e.code.startsWith('observable_target_exists'))).toBe(true)
  })

  it('accepts a magnetic scene even when v is not perpendicular to B', () => {
    const scene = minimalScene()
    scene.particles = [
      {
        id: 'p1',
        type: 'particle',
        mass: quantity(9.11e-31, 'kg', 'mass'),
        charge: quantity(1.6e-19, 'C', 'electric_charge'),
        position: { vector: vec3(0, 0, 0), unit: 'm', dimension: 'length' },
        velocity: { vector: vec3(1e6, 1e6, 0), unit: 'm/s', dimension: 'velocity' },
      },
    ]
    scene.fields = [
      {
        id: 'b1',
        type: 'uniform_magnetic',
        magneticFluxDensity: {
          vector: vec3(0, 0, 0.5),
          unit: 'T',
          dimension: 'magnetic_flux_density',
        },
      },
    ]
    const result = validateScene(scene)
    expect(result.status).toBe('passed')
  })
})
