import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'

import {
  SceneRuntime,
  createConcaveMirrorScene,
  createConvexLensScene,
  createOpticalBenchScene,
  createPlaneMirrorScene,
  createSceneCommand,
  curvedMirrorOf,
  isOpticsScene,
  opticalBenchOf,
  opticalBenchesOf,
  thinLensOf,
  validateScene,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '../src/index.ts'

const cm = (value: number) => quantity(value, 'cm', 'length')

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.getScene()
  /* The generic envelope does not narrow back to the distributive union. */
  return runtime.execute(
    createSceneCommand({
      commandId: `cmd-${type}-${scene.revision}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }) as SceneCommand,
  )
}

describe('createOpticalBenchScene', () => {
  it('builds a pure static optics scene that passes validation', () => {
    const scene = createPlaneMirrorScene()
    expect(isOpticsScene(scene)).toBe(true)
    expect(scene.timeline.endTime?.value).toBe(0)
    expect(validateScene(scene).status).toBe('passed')
    const bench = opticalBenchOf(scene)!
    expect(bench.elements[0]?.type).toBe('plane_mirror')
    expect(bench.object.position.unit).toBe('cm')
    expect(bench.screen?.position.value).toBe(10)
  })

  it('parks the convex lens screen on the sharp-image plane by default', () => {
    const scene = createConvexLensScene({ focalLength: 10, objectDistance: 30 })
    const bench = opticalBenchOf(scene)!
    /* v = uf/(u−f) = 30·10/20 = 15 cm */
    expect(bench.screen?.position.value).toBeCloseTo(15, 9)
    expect(thinLensOf(bench)?.focalLength.value).toBe(10)
  })

  it('parks the concave mirror screen on the sharp-image plane in front', () => {
    const scene = createConcaveMirrorScene({ focalLength: 10, objectDistance: 30 })
    expect(isOpticsScene(scene)).toBe(true)
    expect(validateScene(scene).status).toBe('passed')
    const bench = opticalBenchOf(scene)!
    expect(bench.elements[0]?.type).toBe('curved_mirror')
    expect(curvedMirrorOf(bench)?.focalLength.value).toBe(10)
    /* The mirror folds light back: v = uf/(u−f) = 15 cm IN FRONT (x = −15). */
    expect(bench.screen?.position.value).toBeCloseTo(-15, 9)
  })

  it('parks the screen at −2|f| when the start has no real image', () => {
    const within = createConcaveMirrorScene({ focalLength: 10, objectDistance: 5 })
    expect(opticalBenchOf(within)!.screen?.position.value).toBeCloseTo(-20, 9)
    const convex = createConcaveMirrorScene({ focalLength: -10, objectDistance: 30 })
    const bench = opticalBenchOf(convex)!
    expect(bench.screen?.position.value).toBeCloseTo(-20, 9)
    expect(bench.elements[0]?.name).toBe('凸面镜')
    expect(validateScene(convex).status).toBe('passed')
  })

  it('treats legacy scenes without the collection as having no benches', () => {
    const scene = createPlaneMirrorScene()
    const legacy = { ...scene } as Partial<PhysicsScene>
    delete legacy.opticalBenches
    expect(opticalBenchesOf(legacy as PhysicsScene)).toEqual([])
    expect(isOpticsScene(legacy as PhysicsScene)).toBe(false)
  })

  it('rejects a zero focal length and a non-positive object height in validation', () => {
    const zeroFocal = createOpticalBenchScene({
      object: { position: -20, height: 6 },
      element: { type: 'thin_lens', position: 0, focalLength: 0 },
    })
    expect(validateScene(zeroFocal).status).toBe('failed')

    const flatObject = createOpticalBenchScene({
      object: { position: -20, height: 0 },
      element: { type: 'plane_mirror', position: 0 },
    })
    expect(validateScene(flatObject).status).toBe('failed')
  })
})

describe('optics scene commands', () => {
  it('moves the object and records OpticalObjectPositionChanged', () => {
    const runtime = new SceneRuntime(createConvexLensScene())
    const result = execute(runtime, 'SetOpticalObjectPosition', {
      benchId: 'optical-bench-1',
      position: cm(-15),
    })
    expect(result.ok).toBe(true)
    expect(opticalBenchOf(runtime.getScene())!.object.position.value).toBe(-15)
    expect(runtime.getEvents()[0]?.type).toBe('OpticalObjectPositionChanged')
  })

  it('rejects moving the object onto or past the element atomically', () => {
    const runtime = new SceneRuntime(createConvexLensScene())
    const before = runtime.getScene()
    const onElement = execute(runtime, 'SetOpticalObjectPosition', {
      benchId: 'optical-bench-1',
      position: cm(0),
    })
    expect(onElement.ok).toBe(false)
    if (onElement.ok) throw new Error('Expected command rejection.')
    expect(onElement.error.code).toBe('OPTICAL_OBJECT_BEHIND_ELEMENT')
    expect(runtime.getScene()).toEqual(before)

    const pastElement = execute(runtime, 'SetOpticalObjectPosition', {
      benchId: 'optical-bench-1',
      position: cm(5),
    })
    expect(pastElement.ok).toBe(false)
  })

  it('changes the lens focal length and rejects zero', () => {
    const runtime = new SceneRuntime(createConvexLensScene())
    const ok = execute(runtime, 'SetLensFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'lens-1',
      focalLength: cm(15),
    })
    expect(ok.ok).toBe(true)
    expect(thinLensOf(opticalBenchOf(runtime.getScene())!)?.focalLength.value).toBe(15)

    const zero = execute(runtime, 'SetLensFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'lens-1',
      focalLength: cm(0),
    })
    expect(zero.ok).toBe(false)
    if (zero.ok) throw new Error('Expected command rejection.')
    expect(zero.error.code).toBe('INVALID_LENS_FOCAL_LENGTH')
  })

  it('rejects focal length edits on a plane mirror', () => {
    const runtime = new SceneRuntime(createPlaneMirrorScene())
    const result = execute(runtime, 'SetLensFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'mirror-1',
      focalLength: cm(10),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected command rejection.')
    expect(result.error.code).toBe('ELEMENT_NOT_THIN_LENS')
  })

  it('changes the mirror focal length, allowing the convex sign flip', () => {
    const runtime = new SceneRuntime(createConcaveMirrorScene())
    const ok = execute(runtime, 'SetMirrorFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'mirror-1',
      focalLength: cm(15),
    })
    expect(ok.ok).toBe(true)
    expect(curvedMirrorOf(opticalBenchOf(runtime.getScene())!)?.focalLength.value).toBe(15)
    expect(runtime.getEvents().at(-1)?.type).toBe('MirrorFocalLengthChanged')

    /* f < 0 IS the convex mirror: the sign flip is a legal, auditable edit. */
    const convex = execute(runtime, 'SetMirrorFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'mirror-1',
      focalLength: cm(-15),
    })
    expect(convex.ok).toBe(true)
    expect(curvedMirrorOf(opticalBenchOf(runtime.getScene())!)?.focalLength.value).toBe(-15)

    const zero = execute(runtime, 'SetMirrorFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'mirror-1',
      focalLength: cm(0),
    })
    expect(zero.ok).toBe(false)
    if (zero.ok) throw new Error('Expected command rejection.')
    expect(zero.error.code).toBe('INVALID_MIRROR_FOCAL_LENGTH')
  })

  it('rejects mirror focal length edits on a thin lens', () => {
    const runtime = new SceneRuntime(createConvexLensScene())
    const result = execute(runtime, 'SetMirrorFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'lens-1',
      focalLength: cm(10),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected command rejection.')
    expect(result.error.code).toBe('ELEMENT_NOT_CURVED_MIRROR')
  })

  it('updates object height and screen position with validation', () => {
    const runtime = new SceneRuntime(createConvexLensScene())
    const height = execute(runtime, 'SetOpticalObjectHeight', {
      benchId: 'optical-bench-1',
      height: cm(4),
    })
    expect(height.ok).toBe(true)
    const badHeight = execute(runtime, 'SetOpticalObjectHeight', {
      benchId: 'optical-bench-1',
      height: cm(-2),
    })
    expect(badHeight.ok).toBe(false)
    if (badHeight.ok) throw new Error('Expected command rejection.')
    expect(badHeight.error.code).toBe('INVALID_OPTICAL_OBJECT_HEIGHT')

    const screen = execute(runtime, 'SetOpticalScreenPosition', {
      benchId: 'optical-bench-1',
      position: cm(20),
    })
    expect(screen.ok).toBe(true)
    expect(opticalBenchOf(runtime.getScene())!.screen?.position.value).toBe(20)
  })

  it('reports missing benches, elements and screens as not-found errors', () => {
    const runtime = new SceneRuntime(createConvexLensScene())
    const missingBench = execute(runtime, 'SetOpticalObjectPosition', {
      benchId: 'ghost-bench',
      position: cm(-10),
    })
    expect(missingBench.ok).toBe(false)
    if (missingBench.ok) throw new Error('Expected command rejection.')
    expect(missingBench.error.code).toBe('OPTICAL_BENCH_NOT_FOUND')

    const missingElement = execute(runtime, 'SetLensFocalLength', {
      benchId: 'optical-bench-1',
      elementId: 'ghost-lens',
      focalLength: cm(10),
    })
    expect(missingElement.ok).toBe(false)
    if (missingElement.ok) throw new Error('Expected command rejection.')
    expect(missingElement.error.code).toBe('OPTICAL_ELEMENT_NOT_FOUND')

    const noScreen = new SceneRuntime(
      createOpticalBenchScene({
        object: { position: -20, height: 6 },
        element: { type: 'plane_mirror', position: 0 },
      }),
    )
    const missingScreen = execute(noScreen, 'SetOpticalScreenPosition', {
      benchId: 'optical-bench-1',
      position: cm(10),
    })
    expect(missingScreen.ok).toBe(false)
    if (missingScreen.ok) throw new Error('Expected command rejection.')
    expect(missingScreen.error.code).toBe('OPTICAL_SCREEN_NOT_FOUND')
  })
})
