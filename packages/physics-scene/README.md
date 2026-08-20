# @physicsos/physics-scene

PhysicsScene contract, scene commands, physics events, reducer and revision guard

`SceneRuntime` / `SceneStore` expose `getScene()`, `execute(command)`, and
`getEvents()`. Every successful command increments the scene revision exactly
once and appends its traceable event; stale `expectedRevision` values return
`SCENE_REVISION_CONFLICT` without changing the scene or event log.

`createMagneticScene()` owns the minimum frozen-model scene input, units, and
observable definitions. `createSceneCommand()` lets host adapters create branded
command envelopes from transport-safe string IDs without importing shared ID or
unit internals.

Part of the PhysicsOS physics domain runtime. This package is PhysicsOS-owned and
must never be copied into `vendor/deepseek-harness`.
