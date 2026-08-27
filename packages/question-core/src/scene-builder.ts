import { vec3 } from '@physicsos/physics-math'
import { quantityVector } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
import { asSceneId, asObservableId, asQuestionId, type IsoDateTime } from '@physicsos/shared'
import { defaultCoordinateSystem, type PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsSemanticIR, KnownValue } from './semantic-ir.ts'

export interface SceneBuildResult {
  scene: PhysicsScene
  irToSceneMapping: Record<string, string>
}

function getKnown(ir: PhysicsSemanticIR, key: string): KnownValue | undefined {
  return ir.knowns.find((k) => k.key === key)
}

export function buildSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): SceneBuildResult {
  const now = options.now ?? new Date().toISOString()
  const sceneId = options.sceneId ?? 'question-magnetic-scene'
  const particleId = 'particle-1'
  const fieldId = 'field-1'

  const charge = getKnown(ir, 'charge')
  const mass = getKnown(ir, 'mass')
  const velocity = getKnown(ir, 'velocity')
  const bField = getKnown(ir, 'magnetic_field_strength')

  const chargeValue = charge?.value ?? 1.6e-19
  const massValue = mass?.value ?? 1.67e-27
  const velocityValue = velocity?.value ?? 2e6
  const bValue = bField?.value ?? 0.5
  const fieldDir = ir.fieldDirection === 'out_of_page' ? 1 : -1
  const fieldZ = bValue * fieldDir

  const scene: PhysicsScene = {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
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
    particles: [
      {
        id: particleId,
        type: 'particle',
        mass: quantity(massValue, 'kg', 'mass'),
        charge: quantity(chargeValue, 'C', 'electric_charge'),
        position: quantityVector(vec3(0, 0, 0), 'm', 'length'),
        velocity: quantityVector(vec3(velocityValue, 0, 0), 'm/s', 'velocity'),
      },
    ],
    fields: [
      {
        id: fieldId,
        type: 'uniform_magnetic',
        magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
      },
    ],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    measurementDefinitions: [],
    observableDefinitions: [
      { id: asObservableId('observable-velocity'), type: 'velocity', targetId: particleId, visible: true },
      { id: asObservableId('observable-force'), type: 'force', targetId: particleId, visible: true },
      { id: asObservableId('observable-trajectory'), type: 'trajectory', targetId: particleId, visible: true },
      { id: asObservableId('observable-center'), type: 'geometry', targetId: particleId, visible: false, parameters: { kind: 'orbit_center' } },
      { id: asObservableId('observable-radius'), type: 'geometry', targetId: particleId, visible: false, parameters: { kind: 'radius' } },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: '试题场景：磁场中的带电粒子运动',
      description: '由 Question Parser + Scene Builder 自动生成',
      ...(options.questionId ? { sourceQuestionId: asQuestionId(options.questionId) } : {}),
    },
  }

  return {
    scene,
    irToSceneMapping: {
      particle: particleId,
      magnetic_field: fieldId,
    },
  }
}
