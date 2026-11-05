# Renderer kit contract

Domain modules export synchronous `drawMechanics(snapshot, kit)`, `drawOptics`, `drawWaves`, `drawMatter`, `drawCircuits`, or `drawFields`. They append to a fresh Three Group every frame. Root handles common vectors, trajectories, guides, dimensions, labels and keypoints; domain modules handle domain apparatus, bodies and particles (for electric/magnetic/composite, root handles particles if domain does not).

All coordinates and lengths are raw scene units, Y up; `{x,y,z?}` with z default 0. Root uses one uniform scale and camera. Do not scale the physical endpoints, re-solve physics, mutate snapshot or animate with local time. Deriving apparatus mesh shapes and interpolating a physical segment for an arrowhead is geometry, allowed. `unit = Math.max(view.extent.width,view.extent.height)/12` is a presentation detail size, not vector scale. View.visible[key] !== false means visible.

Kit supplies:

- `THREE`, `group`, `unit`, `palette` (`ink`, `muted`, `metal`, `green`, `blue`, `orange`, `red`, `wood`, `glass`, `purple`). You may use these or a literal restrained color for a physical material.
- `box(at, width, height, depth, color, opts={})` returns Mesh; opts `rotation` in degrees around z, `opacity`, `tag`.
- `sphere(at, radius, color, opts={})` returns Mesh.
- `cylinder(from, to, radius, color, opts={})` returns Mesh; cylinder axis matches endpoints exactly.
- `line(points, color, opts={})` returns Line; opts `dashed`, `opacity`, `tag`.
- `tube(points, radius, color, opts={})` returns Mesh; suitable for wires/coils.
- `arrow(from, to, color, opts={})` returns Group; exact length; no minimum length clamp, zero-length omitted. opts `tag`.
- `circle(at, radius, color, opts={})` returns Line (in xy plane); opts `dashed`, `opacity`, `start` / `end` radians, `tag`.
- `polygon(points, depth, color, opts={})` returns extruded xy Mesh; opts `opacity`,`tag`.
- `label(text, at, opts={})` adds DOM-projected annotation; opts `color`, `size` (px, default 11), `priority` (default 1), `tag`. Fixed screen size; root manages overlap. Avoid long paragraphs, duplicate general readout or too many labels.
- `visible(key)` returns view.visible[key] !== false.

All primitives automatically join kit.group, accept optional `tag` for inspection, and are disposed by root. Methods need finite, nonnegative geometry sizes. Modules should guard missing optional fields, not silently substitute unrelated apparatus. If a material needs direct Three operations, use kit.THREE and kit.group; root traverses disposal.

Physical reference: `overlays/harness/files/packages/client/ui-physicsos/src/client/physics/scene-visual-model.ts` and corresponding renderer implementations. Default snapshots can be decoded with Python from `.../experiment-host/src/universal-template-data.json`, `targets[id]['public/fixture.json']` base64. Inspect representative values and special subfamilies. Do not print giant whole data files.

Owned source files must remain plain ESM with no dependencies other than kit. Do not modify SDK, validators, host source, shared kit, main, CSS or another agent's modules. Do not commit, upload or deploy; root integrates. No need to add tests for decorative mesh choices. Document physical edge cases and how to inspect them in report; root performs real server WebGL and engine-snapshot acceptance.
