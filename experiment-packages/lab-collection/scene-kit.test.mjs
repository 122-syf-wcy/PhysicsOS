import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PHYSICSOS_LAB_KIT_MODULE
assert.ok(modulePath, 'Run with the server-staged kit module')
const { createSceneKit, disposeGroup, fitCameraToBox } = await import(pathToFileURL(modulePath))
const view = { extent: { width: 24, height: 12 }, visible: { force: false } }

test('all primitives retain world scale and signed endpoints', () => {
  const kit = createSceneKit(view)
  const rod = kit.cylinder({ x: 1, y: 2 }, { x: 4, y: 6 }, 0.1, '#000000')
  assert.equal(rod.geometry.parameters.height, 5)
  assert.deepEqual(rod.position.toArray(), [2.5, 4, 0])
  const line = kit.line([{ x: -3, y: 2 }, { x: 4, y: -1 }], '#000000')
  assert.deepEqual(Array.from(line.geometry.attributes.position.array), [-3, 2, 0, 4, -1, 0])
  const arrow = kit.arrow({ x: 2, y: 3 }, { x: 2, y: 3.001 }, '#000000')
  arrow.updateMatrixWorld(true)
  const bounds = new kit.THREE.Box3().setFromObject(arrow)
  assert.ok(Math.abs(bounds.max.y - 3.001) < 1e-6, 'short arrows cannot be enlarged')
  assert.equal(kit.arrow({ x: 2, y: 3 }, { x: 2, y: 3 }, '#000000'), undefined)
  assert.equal(kit.visible('force'), false)
  assert.equal(kit.visible('rays'), true)
  disposeGroup(kit.group)
})

test('owned display geometry and materials are released', () => {
  const kit = createSceneKit(view)
  const sphere = kit.sphere({ x: 0, y: 0 }, 1, '#000000')
  let geometry = false, material = false
  sphere.geometry.addEventListener('dispose', () => { geometry = true })
  sphere.material.addEventListener('dispose', () => { material = true })
  disposeGroup(kit.group)
  assert.equal(geometry, true)
  assert.equal(material, true)
  assert.equal(kit.group.children.length, 0)
})

test('stable entity/subpart topology retains allocations while transforms and sizes change', () => {
  const kit = createSceneKit(view), parts = new Map()
  let factoryCalls = 0
  const frame = (revision, order = ['left', 'right']) => {
    kit.beginFrame(view, 'retained-test')
    for (const id of order) kit.scope(`body:${id}`, () => {
      const box = kit.box({ x: revision / 10, y: 0 }, 1 + revision / 100, 2, 0.4, '#315e52', { key: 'case', tag: 'repeated-tag' })
      const sphere = kit.sphere({ x: 0, y: revision / 20 }, 0.15 + revision / 1000, '#477d9e', { key: 'ball', tag: 'repeated-tag' })
      const rod = kit.cylinder({ x: 0, y: 0 }, { x: revision / 10, y: 2 }, 0.04, '#b8c1c1', { key: 'rod' })
      const custom = kit.customMesh({ x: 0, y: 0 }, '#23312f', { key: 'custom', geometryKey: 'unit-plane',
        geometry: () => { factoryCalls++; return new kit.THREE.PlaneGeometry(1, 1) }, scale3D: { x: 1 + revision / 100, y: 1, z: 1 } })
      const label = kit.label(`${revision} m`, { x: 0, y: 0 }, { key: 'reading', tag: 'repeated-tag' })
      for (const [name, object] of Object.entries({ box, sphere, rod, custom, label })) {
        const key = `${id}/${name}`
        if (parts.has(key)) assert.equal(object, parts.get(key), `${key} was reallocated`)
        else parts.set(key, object)
      }
    })
    kit.endFrame()
  }
  frame(0)
  const allocations = { ...kit.stats }, geometries = [...parts.values()].filter(p => p.geometry).map(p => p.geometry)
  for (let revision = 1; revision <= 50; revision++) frame(revision, revision % 2 ? ['right', 'left'] : ['left', 'right'])
  assert.equal(factoryCalls, 2, 'lazy static geometry factory ran per frame')
  for (const key of ['meshAllocations', 'geometryAllocations', 'materialAllocations', 'labelAllocations']) assert.equal(kit.stats[key], allocations[key], key)
  assert.deepEqual([...parts.values()].filter(p => p.geometry).map(p => p.geometry), geometries)
  assert.notEqual(parts.get('left/box'), parts.get('right/box'))
  kit.dispose()
})

test('factory-local fallback slots do not collapse repeated tags and explicit duplicates fail', () => {
  const kit = createSceneKit(view)
  const first = kit.box({ x: 0, y: 0 }, 1, 1, 1, '#315e52', { tag: 'same' })
  const second = kit.box({ x: 2, y: 0 }, 1, 1, 1, '#315e52', { tag: 'same' })
  kit.endFrame(); kit.beginFrame(view)
  assert.equal(kit.box({ x: 1, y: 0 }, 1, 1, 1, '#315e52', { tag: 'same' }), first)
  assert.equal(kit.box({ x: 3, y: 0 }, 1, 1, 1, '#315e52', { tag: 'same' }), second)
  kit.scope('explicit', () => {
    kit.sphere({ x: 0, y: 0 }, 1, '#315e52', { key: 'part' })
    assert.throws(() => kit.sphere({ x: 0, y: 0 }, 1, '#315e52', { key: 'part' }), /Duplicate retained part/)
  })
  kit.dispose()
})

test('dynamic paths reuse buffers, exact draw counts, distances and live bounds after growth/shrink/empty', () => {
  const kit = createSceneKit(view), points = [{ x: -3, y: 2 }, { x: 4, y: -1 }, { x: 500, y: 700 }]
  const before = JSON.stringify(points)
  const frame = samples => {
    kit.beginFrame(view)
    const line = kit.scope('path', () => kit.line(samples, '#315e52', { key: 'stroke', dashed: true }))
    kit.endFrame(); return line
  }
  const line = frame(points), geometry = line.geometry, position = geometry.attributes.position
  assert.equal(geometry.drawRange.count, 3)
  assert.equal(geometry.userData.sampleCount, 3)
  assert.equal(position.usage, kit.THREE.DynamicDrawUsage)
  const short = frame(points.slice(0, 2))
  assert.equal(short, line); assert.equal(short.geometry, geometry); assert.equal(geometry.attributes.position, position)
  assert.equal(geometry.drawRange.count, 2); assert.equal(position.count, 2)
  assert.deepEqual(geometry.boundingBox.min.toArray(), [-3, -1, 0]); assert.deepEqual(geometry.boundingBox.max.toArray(), [4, 2, 0])
  assert.ok(Math.abs(geometry.attributes.lineDistance.array[1] - Math.hypot(7, -3)) < 1e-6)
  assert.equal(geometry.attributes.lineDistance.count, 2)
  const grown = [...points, { x: -4, y: 6 }]
  let bufferRetirements = 0; geometry.addEventListener('dispose', () => bufferRetirements++)
  frame(grown)
  assert.equal(line.geometry, geometry); assert.equal(bufferRetirements, 1, 'old GPU buffers must be released before resizing')
  const largerBuffer = geometry.attributes.position
  frame(grown); assert.equal(geometry.attributes.position, largerBuffer)
  assert.equal(frame([]), undefined); assert.equal(line.visible, false)
  assert.equal(geometry.drawRange.count, 0); assert.equal(geometry.attributes.position.count, 0)
  assert.equal(geometry.boundingBox.isEmpty(), true)
  assert.equal(frame(points.slice(0, 2)), line)
  assert.equal(JSON.stringify(points), before, 'renderer mutated trusted samples')
  kit.dispose()
})

test('tube uses original straight segments rather than a curve that cuts measured corners', () => {
  const kit = createSceneKit(view), points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], radius = 0.1
  const tube = kit.tube(points, radius, '#315e52', { key: 'wire', curve: 'polyline' }), geometry = tube.geometry
  assert.equal(geometry.userData.sampleCount, points.length)
  assert.equal(geometry.userData.pathKind, 'polyline'); assert.equal(geometry.drawRange.count, 72)
  const array = geometry.attributes.position.array
  for (let i = 0; i < geometry.drawRange.count * 3; i += 3) {
    const x = array[i], y = array[i + 1], z = array[i + 2]
    assert.ok(Math.min(Math.hypot(y, z), Math.hypot(x - 2, z)) <= radius + 1e-6, 'surface left the exact original segment tube')
  }
  kit.endFrame(); kit.beginFrame(view)
  assert.equal(kit.tube(points, radius, '#315e52', { key: 'wire' }), tube)
  assert.equal(tube.geometry, geometry)
  kit.dispose()
})

test('materials are entity-private and a dark bulb cannot inherit another bulb emissive state', () => {
  const kit = createSceneKit(view)
  const bulb = (id, glow = 0) => kit.scope(id, () => {
    const mesh = kit.sphere({ x: 0, y: 0 }, 1, '#315e52', { key: 'bulb' })
    if (glow) { mesh.material.emissive.set('#df9a35'); mesh.material.emissiveIntensity = glow }
    return mesh
  })
  const first = bulb('one', 0.8), second = bulb('two')
  assert.notEqual(first.material, second.material)
  assert.equal(second.material.emissive.getHex(), 0)
  const otherKit = createSceneKit(view), other = otherKit.scope('one', () => otherKit.sphere({ x: 0, y: 0 }, 1, '#315e52', { key: 'bulb' }))
  assert.notEqual(first.material, other.material, 'materials are not shared across displays')
  kit.endFrame(); kit.beginFrame(view)
  assert.equal(bulb('one'), first)
  assert.equal(first.material.emissive.getHex(), 0, 'no stale glow on later dark frame')
  kit.dispose(); otherKit.dispose()
})

test('dispose is idempotent, arrows own their buffers, borrowed textures survive and owned textures retire', () => {
  const kit = createSceneKit(view), borrowed = new kit.THREE.Texture(), owned = new kit.THREE.Texture()
  const one = kit.sphere({ x: 0, y: 0 }, 1, '#315e52', { map: borrowed, ownedTextures: [owned] })
  const arrow = kit.arrow({ x: 0, y: 0 }, { x: 0, y: 2 }, '#315e52')
  const otherKit = createSceneKit(view), otherArrow = otherKit.arrow({ x: 0, y: 0 }, { x: 0, y: 2 }, '#315e52')
  assert.notEqual(arrow.line.geometry, otherArrow.line.geometry)
  let geometry = 0, material = 0, borrowedDisposals = 0, ownedDisposals = 0, otherDisposals = 0
  one.geometry.addEventListener('dispose', () => geometry++); one.material.addEventListener('dispose', () => material++)
  borrowed.addEventListener('dispose', () => borrowedDisposals++); owned.addEventListener('dispose', () => ownedDisposals++)
  otherArrow.line.geometry.addEventListener('dispose', () => otherDisposals++)
  kit.dispose(); kit.dispose(); disposeGroup(kit.group)
  assert.equal(geometry, 1); assert.equal(material, 1); assert.equal(ownedDisposals, 1); assert.equal(borrowedDisposals, 0); assert.equal(otherDisposals, 0)
  assert.equal(kit.group.children.length, 0)
  otherKit.dispose(); borrowed.dispose()
})

test('retained local bounds never absorb camera normalization or unused trajectory capacity', () => {
  const kit = createSceneKit(view), world = new kit.THREE.Group()
  world.scale.setScalar(0.5); world.position.set(20, -30, 10); world.add(kit.group)
  kit.sphere({ x: 2, y: 4 }, 1, '#315e52', { key: 'body' })
  kit.endFrame()
  const bounds = kit.bounds()
  assert.ok(Math.abs(bounds.min.x - 1) < 1e-6 && Math.abs(bounds.max.x - 3) < 1e-6)
  assert.ok(Math.abs(bounds.min.y - 3) < 1e-6 && Math.abs(bounds.max.y - 5) < 1e-6)
  kit.dispose()
})

test('every corner stays visible at allowed orbit angles and phone aspect', () => {
  assert.equal(typeof fitCameraToBox, 'function')
  const { THREE } = createSceneKit(view)
  for (const aspect of [280 / 220, 390 / 220, 390 / 420, 956 / 500]) for (const [yaw, pitch] of [[0, 0], [-0.48, 0.23], [0.85, 0.65], [-0.85, -0.2]]) {
    const span = { x: 2.8, y: 2.82, z: 1.6 }
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    camera.position.set(Math.sin(yaw), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize().multiplyScalar(40)
    camera.lookAt(0, 0, 0)
    fitCameraToBox(camera, span, aspect)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const p = new THREE.Vector3(x * span.x / 2, y * span.y / 2, z * span.z / 2).project(camera)
      assert.ok(Math.abs(p.x) <= 0.95 && Math.abs(p.y) <= 0.95, `cropped at ${yaw}/${pitch}/${aspect}`)
    }
  }
})
