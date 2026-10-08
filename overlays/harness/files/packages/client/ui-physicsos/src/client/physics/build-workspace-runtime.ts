import {
  isCurrentScene,
  isEnergyScene,
  isLeverScene,
  isNoiseScene,
  isLightScene,
  isPressureScene,
  isThermometerScene,
  isTransformerScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { createAcousticsWorkspaceRuntime } from './acoustics-workspace-runtime.ts'
import { createCircuitWorkspaceRuntime } from './circuit-workspace-runtime.ts'
import { createFluidWorkspaceRuntime } from './fluid-workspace-runtime.ts'
import { createPressureWorkspaceRuntime } from './pressure-workspace-runtime.ts'
import { createCurrentWorkspaceRuntime } from './current-workspace-runtime.ts'
import { createEnergyWorkspaceRuntime } from './energy-workspace-runtime.ts'
import { createLightWorkspaceRuntime } from './light-workspace-runtime.ts'
import { createTransformerWorkspaceRuntime } from './transformer-workspace-runtime.ts'
import { createThermometerWorkspaceRuntime } from './thermometer-workspace-runtime.ts'
import { createNoiseWorkspaceRuntime } from './noise-workspace-runtime.ts'
import { createThermalWorkspaceRuntime } from './thermal-workspace-runtime.ts'
import { createCompositeWorkspaceRuntime } from './composite-workspace-runtime.ts'
import { createElectricWorkspaceRuntime } from './electric-workspace-runtime.ts'
import { createMagneticWorkspaceRuntime } from './magnetic-workspace-runtime.ts'
import { createMechanicsWorkspaceRuntime } from './mechanics-workspace-runtime.ts'
import { createModernPhysicsWorkspaceRuntime } from './modern-workspace-runtime.ts'
import {
  createCollisionWorkspaceRuntime,
  isCollisionSceneInput,
} from './collision-workspace-runtime.ts'
import { createLeverWorkspaceRuntime } from './lever-workspace-runtime.ts'
import { createOpticsWorkspaceRuntime } from './optics-workspace-runtime.ts'
import { createInductionWorkspaceRuntime } from './induction-workspace-runtime.ts'
import { createWaveWorkspaceRuntime } from './wave-workspace-runtime.ts'
import type { WorkspaceRuntime } from './workspace-runtime.ts'
import type { SupportedSceneDomain } from './domain-of-scene.ts'

/* Exported for the chat scene card, which mounts the same domain runtimes the
   Lab does — one dispatch site, so a card can never disagree with the Lab on
   which engine a scene runs on. */
const createWorkspaceRuntime = (
  domain: SupportedSceneDomain | 'unsupported',
  scene: PhysicsScene | undefined,
): WorkspaceRuntime | null => {
  /* Every domain is matched explicitly and the switch has no default, so a newly
     added domain is a compile error here rather than silently being solved by
     the wrong engine — the engine would then reject the scene at canHandle and
     the surface would fail with a message about magnetism. */
  switch (domain) {
    case 'unsupported':
      return null
    case 'mechanics':
      if (scene !== undefined && isLeverScene(scene)) return createLeverWorkspaceRuntime(scene)
      /* The energy rig is the mechanics domain's third bench — a ramp with no
         bodies — so the bench picks the adapter here too. */
      if (scene !== undefined && isEnergyScene(scene)) return createEnergyWorkspaceRuntime(scene)
      if (scene !== undefined && isCollisionSceneInput(scene))
        return createCollisionWorkspaceRuntime(scene)
      return scene === undefined ? null : createMechanicsWorkspaceRuntime(scene)
    case 'electric':
      return scene === undefined ? null : createElectricWorkspaceRuntime(scene)
    case 'circuit':
      return scene === undefined ? null : createCircuitWorkspaceRuntime(scene)
    case 'optics':
      /* The optics domain carries two benches — the imaging bench and the
         pinhole rig — and the bench picks the adapter. */
      if (scene === undefined) return null
      return isLightScene(scene)
        ? createLightWorkspaceRuntime(scene)
        : createOpticsWorkspaceRuntime(scene)
    case 'acoustics':
      /* The acoustics domain carries two benches — the echo range and the noise
         rig — and the bench picks the adapter. */
      if (scene === undefined) return null
      return isNoiseScene(scene)
        ? createNoiseWorkspaceRuntime(scene)
        : createAcousticsWorkspaceRuntime(scene)
    case 'fluid':
      /* The fluid domain carries two benches — the buoyancy tank and the three
         pressure rigs — and they share a canvas but not a runtime, so the bench
         picks the adapter the same way the lever branch above picks its own. */
      if (scene === undefined) return null
      return isPressureScene(scene)
        ? createPressureWorkspaceRuntime(scene)
        : createFluidWorkspaceRuntime(scene)
    case 'thermal':
      /* The thermal domain carries two benches — the heating benches and the
         thermometer — and the bench picks the adapter. */
      if (scene === undefined) return null
      return isThermometerScene(scene)
        ? createThermometerWorkspaceRuntime(scene)
        : createThermalWorkspaceRuntime(scene)
    case 'induction':
      /* The induction domain carries two benches — the EMF rigs and the
         transformer — and the bench picks the adapter. */
      if (scene === undefined) return null
      return isTransformerScene(scene)
        ? createTransformerWorkspaceRuntime(scene)
        : createInductionWorkspaceRuntime(scene)
    case 'wave':
      return scene === undefined ? null : createWaveWorkspaceRuntime(scene)
    case 'composite':
      return scene === undefined ? null : createCompositeWorkspaceRuntime(scene)
    case 'modern':
      return scene === undefined ? null : createModernPhysicsWorkspaceRuntime(scene)
    case 'magnetic':
      /* The magnetic domain carries two benches — the Lorentz particle scene and
         the current-magnetic rigs — and they share a canvas but not a runtime,
         so the bench picks the adapter here the same way the fluid branch above
         picks between the tank and the pressure rigs. */
      if (scene === undefined) return null
      return isCurrentScene(scene)
        ? createCurrentWorkspaceRuntime(scene)
        : createMagneticWorkspaceRuntime(scene)
  }
}

/** Rebuild only on an explicit origin restore; persisted branches retain original facts. */
export function buildWorkspaceRuntime(
  domain: SupportedSceneDomain | 'unsupported',
  scene: PhysicsScene | undefined,
  originScene?: PhysicsScene,
): WorkspaceRuntime | null {
  const initial = createWorkspaceRuntime(domain, scene)
  if (initial === null || originScene === undefined) return initial
  let current: WorkspaceRuntime = initial
  return new Proxy(current, {
    get(_target, property) {
      if (property === 'restoreOrigin') return () => {
        const restored = createWorkspaceRuntime(domain, originScene)
        if (restored !== null) current = restored
        return current.getSnapshot()
      }
      const value: unknown = Reflect.get(current, property)
      return typeof value === 'function' ? value.bind(current) as unknown : value
    },
  })
}
