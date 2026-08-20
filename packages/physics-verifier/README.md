# @physicsos/physics-verifier

Verifies a magnetic `PhysicsScene` together with an already-produced
`SimulationResult`. It never calls an engine and never regenerates trajectory
states.

## API

```ts
import { MagneticPhysicsVerifier, verifyMagneticScene } from '@physicsos/physics-verifier'

const verification = verifyMagneticScene(scene, simulation)

const verifier = new MagneticPhysicsVerifier({ tolerance })
const sameVerification = verifier.verify(scene, simulation)
```

The return value is the `VerificationResult` contract owned by
`@physicsos/physics-core`:

```ts
{
  status,
  checks,
  warnings,
  errors,
}
```

Every check stores `expected`, `actual`, and the exact `PhysicsTolerance` used in
`check.details`. Failed checks are promoted to structured `errors` through the
core `summarizeVerification` helper; this package does not define a competing
result envelope.

## Magnetic checks

- scene schema/revision validation and result scene/revision binding
- finite-number validation across the scene and result
- canonical unit and dimension checks for radius, period, angular velocity, and force
- the frozen magnetic model preconditions and all five engine-emitted assumptions
- speed conservation at `0`, `T/4`, `T/2`, `3T/4`, and `T`
- `F · v ≈ 0` at every verification sample
- `r ≈ mv / (|q|B)`, `T ≈ 2πm / (|q|B)`, and `ω ≈ |q|B / m`
- `|F| ≈ |q|vB` for the derived magnitude and sampled force vectors
- supplied `stateAt(T) ≈ stateAt(0)` position/velocity closure

All numeric comparisons use a single `PhysicsTolerance`. Pass a custom policy to
the constructor or function when a caller needs a documented domain policy;
otherwise `DEFAULT_TOLERANCE` from `physics-core` is used.

Part of the PhysicsOS physics domain runtime. This package is PhysicsOS-owned and
must never be copied into `vendor/deepseek-harness`.
