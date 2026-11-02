import { expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createLensThreeScene } from '../src/client/experiments/lens-three-scene.ts'

it('places 3D apparatus and real/virtual image from the same verified coordinates', () => {
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const bench = createLensThreeScene(runtime.getSnapshot().view)
  expect(bench.group.getObjectByName('object')?.position.x).toBeCloseTo(-30)
  expect(bench.group.getObjectByName('screen')?.position.x).toBeCloseTo(15)
  expect(bench.group.getObjectByName('image')?.position.x).toBeCloseTo(15)
  bench.update(runtime.editParameter('object-distance',5).view)
  expect(bench.group.getObjectByName('image')?.position.x).toBeCloseTo(-10)
  expect(bench.group.getObjectByName('image')?.userData.nature).toBe('virtual')
  bench.update(runtime.editParameter('object-distance',10).view)
  expect(bench.group.getObjectByName('image')).toBeUndefined()
  bench.dispose()
})

it('keeps near-focus geometry bounded and releases every GPU resource exactly once', () => {
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const bench = createLensThreeScene(runtime.editParameter('object-distance',10.0001).view)
  const disposed: string[] = []
  const tracked = new Set<string>()
  bench.group.traverse(object => {
    const mesh = object as unknown as {geometry?: {uuid:string;attributes?:{position?:{array:ArrayLike<number>}};addEventListener:(type:string,callback:()=>void)=>void};material?:{uuid:string;addEventListener:(type:string,callback:()=>void)=>void}}
    for(const resource of [mesh.geometry,mesh.material]) {
      if(resource===undefined || tracked.has(resource.uuid)) continue
      tracked.add(resource.uuid)
      resource.addEventListener('dispose',() => disposed.push(resource.uuid))
    }
    const values = mesh.geometry?.attributes?.position?.array
    if(values) for(const value of Array.from(values)) expect(Number.isFinite(value) && Math.abs(value)<1000).toBe(true)
  })
  bench.dispose()
  bench.dispose()
  expect(new Set(disposed).size).toBe(tracked.size)
  expect(disposed.length).toBe(tracked.size)
})
