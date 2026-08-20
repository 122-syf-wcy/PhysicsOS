# @physicsos/physics-observation

Observation runtime: turns `PhysicsScene + SimulationResult + SimulationState`
into renderer-neutral magnetic observations.

## API

```ts
import { observeMagneticScene } from '@physicsos/physics-observation'

const observationState = observeMagneticScene({ scene, simulation, state })
```

The runtime emits velocity, Lorentz-force, trajectory, orbit-center, and radius
observations only when their `ObservableDefinition.visible` flag is enabled. It
never solves a trajectory or recalculates a force: values are read from Engine
facts and validated at the Observation boundary. Renderer concerns such as
grid, axes, scale bars, field glyphs, and background patterns remain outside
this package.

Part of the PhysicsOS physics domain runtime. This package is PhysicsOS-owned and
must never be copied into `vendor/deepseek-harness`.
