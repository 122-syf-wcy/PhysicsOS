import { afterEach, expect, it, vi } from 'vitest'
import { ElectricEngine } from '@physicsos/engine-electric'
import { ElectricRegionEngine } from '@physicsos/engine-electric-region'
import { CircuitEngine } from '@physicsos/engine-circuit'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
import { createElectricScene, createEmfMeasurementScene, createMechanicsScene, createParallelPlateScene } from '@physicsos/physics-scene'
import { createElectricWorkspaceRuntime } from '../src/client/physics/electric-workspace-runtime.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { addComponent } from '../src/client/physics/circuit-builder.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'

afterEach(() => { vi.restoreAllMocks() })

it.each([
  ['electric', ElectricEngine, () => createElectricWorkspaceRuntime(createElectricScene()), 'E'],
  ['electric region', ElectricRegionEngine, () => createElectricWorkspaceRuntime(createParallelPlateScene()), 'electricFieldStrength'],
  ['circuit', CircuitEngine, () => createCircuitWorkspaceRuntime(createEmfMeasurementScene()), 'emf'],
  ['mechanics', MechanicsEngine, () => createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'uniform_linear_motion' })), 'mass'],
] as const)('%s simulates once across 600 frames and invalidates after a fact edit', (_domain, Engine, create, parameter) => {
  const simulate = vi.spyOn(Engine.prototype, 'simulate')
  const runtime = create()
  const initial = runtime.getSnapshot()
  expect(initial.status).not.toBe('failed')
  runtime.setRunning(true)
  for (let frame = 0; frame < 600; frame += 1) runtime.advance(initial.clock.total / 1200)
  expect(simulate).toHaveBeenCalledTimes(1)
  const editable = initial.inspector.flatMap(section => section.parameters ?? []).find(row => row.id === parameter)
  expect(editable, `missing parameter ${parameter}`).toBeDefined()
  runtime.editParameter(parameter, editable!.value * 1.2)
  expect(simulate).toHaveBeenCalledTimes(2)
  runtime.seek(0)
  expect(simulate).toHaveBeenCalledTimes(2)
})

it('retains mechanics static panels while the clock and readings change', () => {
  const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'uniformly_accelerated_motion', acceleration: { x: 2, y: 0, z: 0 } }))
  const initial = runtime.getSnapshot()
  const next = runtime.seek(initial.clock.total / 2)
  expect(next.clock.time).toBeGreaterThan(initial.clock.time)
  expect(next.charts).toBe(initial.charts)
  expect(next.table).toBe(initial.table)
  expect(next.verification).toBe(initial.verification)
  expect(next.inspector).not.toEqual(initial.inspector)
  expect(runtime.editParameter('mass', 2).charts).not.toBe(initial.charts)
})


it('keeps committed free-build values when the next draft edit is applied', () => {
  const runtime = createCircuitWorkspaceRuntime(createEmfMeasurementScene())
  runtime.enterBuilder()
  runtime.editParameter('emf', 2)
  runtime.applyDraftEdit(draft => addComponent(draft, 'resistor').draft)
  const source = runtime.getScene().circuits[0]?.components.find(component => component.type === 'voltage_source')
  expect(source?.voltage.value).toBe(2)
})
