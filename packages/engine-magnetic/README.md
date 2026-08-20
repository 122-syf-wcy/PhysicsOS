# @physicsos/engine-magnetic

Magnetic physics engine for one charged particle in a uniform magnetic field,
with `v perpendicular B`, magnetic force only, and a 2D analytical circular
motion solver.

`simulate(scene, request)` emits a deterministic analytical trajectory that
contains the five required verification checkpoints and enough intermediate
states for renderer-neutral circular-path observations, together with traceable
derived facts. `stateAt(scene, time)` and the host-facing
`stateAtSeconds(scene, seconds)` return the analytical state used by Timeline
playback. The model does not cover electric fields, gravity, boundaries,
relativistic effects, or a velocity component parallel to the field.

Part of the PhysicsOS physics domain runtime. This package is PhysicsOS-owned and
must never be copied into `vendor/deepseek-harness`.
