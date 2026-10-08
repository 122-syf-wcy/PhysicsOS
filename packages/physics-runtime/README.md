# Shared physics runtime

`ENGINE_CAPABILITIES` binds each engine to its request builder, teaching domain,
verification policy and supported question models. `pickEngine(scene)` selects
by physical apparatus. `questionEngine(domain, model)` respects the narrower
question-parser capabilities. `simulateScene` preserves engine verification and
adds independent mechanics or magnetic verification. This package depends on
engines and the verifier, never on question-core or agent-tools.

`assertVerifiedSimulation` in physics-core is the common observation boundary:
results must match the exact scene ID and revision and must not have failed
verification. Model-facing observations use this boundary before reading state.

Simulation times are absolute scene times. Timed events are restricted to the
requested inclusive interval, including zero-duration endpoint observations;
static bench initialization events at time zero are absent from later windows. Dynamic runs include both requested
endpoints and honor the bounded storage sample count (`outputSampleRate`, capped
at 1024). Additional event samples remain engine-owned. A zero-duration run may
contain one state. Static models (point charges, imaging, energy ledger, light,
noise, pressure, thermometer, transformer and current-field benches) keep a single
state at the requested start time; end time is validated but does not manufacture
a trajectory. Their state values do not depend on the clock.

Mechanics summary velocity is evaluated at the end time. Summary displacement
measures the requested interval, while per-state displacement remains relative
to scene time zero. Independent constant-acceleration verification checks every
sample against the scene inputs and checks summary quantities against the window.
Nonconstant rigs retain their engine-specific conservation/constraint checks,
with shared scene/schema/finite-state checks at the independent boundary.
