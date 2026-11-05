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

test('old frame geometry and materials are released', () => {
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

test('every corner stays visible at allowed orbit angles and phone aspect', () => {
  assert.equal(typeof fitCameraToBox, 'function')
  const { THREE } = createSceneKit(view)
  for (const aspect of [390 / 420, 956 / 500]) for (const [yaw, pitch] of [[0, 0], [-0.48, 0.23], [0.85, 0.65], [-0.85, -0.2]]) {
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
