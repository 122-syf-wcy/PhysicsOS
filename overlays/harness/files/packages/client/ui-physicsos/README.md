# @deepseek-ai/dsh-client-ui-physicsos

PhysicsOS product overlay for the DeepSeek Harness Web Client. It registers only declared sidebar, hero, profile, and conversation-surface slots. It does not replace `ConversationRoot` or modify Agent Loop, Session, and Tools.

## Runtime boundary

```text
Question / Inspector / Timeline
  -> PhysicsScene + revision
  -> MagneticEngine or MechanicsEngine
  -> Verifier
  -> Observation
  -> SceneVisualModel
  -> PhysicsCanvas
```

`PhysicsCanvas` is the single production renderer for magnetic and mechanics scenes. React components do not calculate answer facts. Question → Lab passes the same `PhysicsScene` revision.

Playback uses `requestAnimationFrame`. A magnetic orbit is normalized to a visible wall-clock cycle, while each frame still reads an analytical Engine state. Verified magnetic simulation data is cached between frames; mechanics playback uses exact `MechanicsEngine.stateAt` instead of snapping to trajectory samples.

## Implemented surfaces

- PhysicsOS Home and Harness sidebar chrome
- Magnetic Lab with revisioned editing, observables, timeline, data, charts, derivation, and events
- Mechanics Lab for uniform motion, uniform acceleration, projectile motion, Newton's second law, and frictionless incline
- Question Space with 16 deterministic examples and Question → Lab
- Desktop, narrow desktop, and mobile layouts

## Known limitations

- Image/PDF/OCR/VLM ingest is not connected.
- Save, AI tutor, template library, and user-learning persistence are not complete business flows.
- Electric, Circuit, Induction, Optics, Wave, teacher, and desktop products remain future work.

## Verification

From the repository root:

```sh
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
```

## Model experience

This package does not directly assemble or send provider requests. Model configuration and conversation behavior remain owned by Harness.
