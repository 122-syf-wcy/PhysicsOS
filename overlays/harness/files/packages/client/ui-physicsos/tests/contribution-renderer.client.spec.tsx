// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { contributionSnapshot } from '../src/client/experiments/contribution-protocol.ts'
import { mountLens } from '../../../../../../developer-kit/experiment-template/src/lens-renderer.ts'

// Keep real geometry/materials/scene transforms; only replace unavailable jsdom WebGL.
const captured = vi.hoisted(() => ({ scene: undefined as THREE.Scene | undefined }))
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>()
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      setPixelRatio() {}
      setSize() {}
      render(scene: THREE.Scene) {
        captured.scene = scene
      }
      dispose() {}
      forceContextLoss() {}
    },
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  captured.scene = undefined
})
it('height changes real candle geometry and image/ray switches hide their real Three objects without changing engine readings', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const draws: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (draw: FrameRequestCallback) => {
    draws.push(draw)
    return draws.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const host = document.createElement('div')
  const mounted = mountLens(host, () => {})
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const update = () => {
    mounted.update(contributionSnapshot(runtime.getSnapshot()))
    while (draws.length) draws.shift()?.(0)
  }
  update()
  const meshes: THREE.Mesh[] = []
  captured.scene?.traverse((entry) => {
    if (entry instanceof THREE.Mesh) meshes.push(entry)
  })
  const candle = meshes.find((mesh) => mesh.geometry instanceof THREE.CylinderGeometry)
  expect(candle).toBeDefined()
  candle?.updateWorldMatrix(true, false)
  expect(new THREE.Box3().setFromObject(candle!).getSize(new THREE.Vector3()).y).toBeCloseTo(6)
  runtime.editParameter('object-height', 9)
  update()
  expect(new THREE.Box3().setFromObject(candle!).getSize(new THREE.Vector3()).y).toBeCloseTo(9)
  const image = meshes.find(
    (mesh) => mesh.geometry instanceof THREE.BoxGeometry && mesh.geometry.parameters.width === 0.28,
  )?.parent
  expect(image?.visible).toBe(true)
  const lines: THREE.Line[] = []
  captured.scene?.traverse((entry) => {
    if (entry instanceof THREE.Line) lines.push(entry)
  })
  expect(lines).toHaveLength(3)
  expect(Array.from(lines[0]!.geometry.getAttribute('position').array).slice(0, 6)).toEqual([
    -30, 9, 0, 0, 9, 0,
  ])
  const result = contributionSnapshot(runtime.getSnapshot()).result
  runtime.setObservable('image', false)
  runtime.setObservable('rays', false)
  update()
  expect(image?.visible).toBe(false)
  const remaining: THREE.Line[] = []
  captured.scene?.traverse((entry) => {
    if (entry instanceof THREE.Line && entry.visible && entry.parent?.visible) remaining.push(entry)
  })
  expect(remaining).toHaveLength(0)
  expect(contributionSnapshot(runtime.getSnapshot()).result).toEqual(result)
  runtime.editParameter('object-distance', 5)
  runtime.setObservable('rays', true)
  update()
  const virtual: THREE.Line[] = []
  captured.scene?.traverse((entry) => {
    if (entry instanceof THREE.Line && entry.material instanceof THREE.LineDashedMaterial)
      virtual.push(entry)
  })
  expect(virtual).toHaveLength(3)
  expect(Array.from(virtual[0]!.geometry.getAttribute('position').array).slice(-3)).toEqual([
    -10, 18, 0,
  ])
  const disposed = vi.spyOn(virtual[0]!.geometry, 'dispose')
  mounted.dispose()
  expect(disposed).toHaveBeenCalledOnce()
  expect(host.querySelector('canvas')).toBeNull()
})
