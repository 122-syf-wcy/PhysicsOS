# All experiment visual packages Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent renderer tasks, with root integration and independent review. Steps use checkbox syntax.

**Goal:** Build and publish 76 independently versioned, physically faithful Three.js experiment packages.

**Architecture:** Decode canonical V3 download data to package workspaces; overlay authored renderer modules and a minimal responsive shell. Domain renderers consume immutable platform visual facts, while the existing SDK handles intents and render acknowledgement. Release and publish using existing validators and APIs.

**Tech Stack:** JavaScript ESM, Three.js, existing V3 SDK, Node 24, Playwright, server Docker.

**Spec:** `docs/superpowers/specs/2026-11-05-all-experiment-visuals.md`

## Global Constraints

- 76 experiments / 12 domains; `schemaVersion: 3`, `protocolVersion: 3`, `renderer: three`.
- No physics solver inside renderer; preserve world coordinates and upstream visibility.
- No CDN, secrets, arbitrary host access or external runtime resources.
- Build/test/deploy only on 107.151.246.59 Docker; retain existing production fixes and restore points.
- Existing user authorization covers autonomous implementation, upload, review and publish.

## Review Focus

- Zero / negative values, virtual images and open switches must retain their physical meaning.
- Hidden layers must stay hidden across frames; lifecycle must release GPU resources.
- Extremely different scene scales and tall mobile views must preserve aspect and readable apparatus.
- Multiple pending frames must acknowledge only completed drawing; host owns timing and state.
- Publication must bind exact archive SHA, preserve older pins and report any partial batch explicitly.

### Task 1: Rendering infrastructure and package build

Files: `experiment-packages/lab-collection/src/{renderer,scene-kit,main}.js`, `experiment-packages/lab-collection/public/{index.html,assets/experiment.css}`, `scripts/developers/build-lab-collection.mjs`.

Interface: domain functions receive `(snapshot, kit)` and append geometry to `kit.group`. Kit operates in raw scene coordinates and provides THREE, unit (max extent / 12), palette, box, sphere, cylinder, tube, line, arrow, circle, polygon, label. Object arguments use `{x,y,z?}`. Root owns camera, uniform mapping, geometry/material disposal, common vectors/trajectories/labels/readouts and observer cleanup.

- [ ] Establish meaningful release coverage and projection/visibility checks in server Docker.
- [ ] Implement kit/shell and decode canonical templates, overlay authored files, bundle local Three, run normal release per target.
- [ ] Verify 76 matching manifests, unique target bindings, hashes, complete resource validation.

### Task 2: Mechanics renderer (24 experiments)

File: `experiment-packages/lab-collection/src/mechanics.js`; export `drawMechanics(snapshot, kit)`.

- [ ] Map all mechanics view families and retain precise body/rig anchors, springs, pivots, balance beam, tracks, energy apparatus.
- [ ] Implement distinctive physical apparatus and target-specific details from snapshot only.
- [ ] Verify baseline and evolved snapshots; record review notes.

### Task 3: Optics / wave / acoustics / fluid / thermal / modern renderer (24 experiments)

Files: `experiment-packages/lab-collection/src/{optics,waves,matter}.js`; export `drawOptics`, `drawWaves` (wave/acoustics), `drawMatter` (fluid/thermal/modern).

- [ ] Preserve lens/mirror geometry, real/virtual rays, refraction/pinhole, exact wave samples, tank/probe/thermometer facts.
- [ ] Implement apparatus without recalculating image formation, waves or temperature.
- [ ] Verify characteristic cases and visibility, including all subfamilies.

### Task 4: Electricity / magnetic / induction / composite renderer (28 experiments)

Files: `experiment-packages/lab-collection/src/{circuits,fields}.js`; export `drawCircuits` and `drawFields`.

- [ ] Preserve wire endpoints and topology, switch state, component ratings and meter readings.
- [ ] Draw plates/charges, bounded fields, magnetic signs, coils, motor and induction rails from visual facts.
- [ ] Verify current/field direction, zero values and all subfamilies.

### Task 5: Server browser acceptance, review and publication

Files: `tests/acceptance/lab-collection.mjs`, `scripts/developers/publish-lab-collection.mjs`, report/screenshots.

- [ ] Render all 76 real engine fixtures in WebGL; inspect desktop/mobile contact sheets and targeted frames.
- [ ] Use isolated candidate upload/preview/approval for representative domains and real parameter/time changes; fix observed faults.
- [ ] Independent code/physics review; complete required checks with recorded evidence.
- [ ] Recheck remote/main/runtime, create server recovery point, publish exact verified archives via API, verify all active IDs/SHA and production browser loads.
- [ ] Commit source and report, synchronize Git without overwriting existing work, deliver concise result and links.
